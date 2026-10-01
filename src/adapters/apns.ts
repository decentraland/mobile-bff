// Apple Push Notification service over its HTTP/2 provider API, no SDK: one POST per device
// token with an ES256 provider JWT, cached for 50 minutes (Apple rejects tokens older than 1h).
// Spec: https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns

import http2 from 'node:http2'
import { createPrivateKey, KeyObject, sign } from 'node:crypto'
import { IBaseComponent } from '@well-known-components/interfaces'
import { AppComponents } from '../types'
import { IPushSender, PushMessage, SendResult } from './push-sender'

const PRODUCTION_HOST = 'https://api.push.apple.com'
const SANDBOX_HOST = 'https://api.sandbox.push.apple.com'
const DEFAULT_BUNDLE_ID = 'org.decentraland.godotexplorer'
const SEND_TIMEOUT_MS = 10_000
const PROVIDER_TOKEN_TTL_MS = 50 * 60 * 1000

export type IApnsComponent = IPushSender & IBaseComponent

// Apple's `reason` strings, split by what to do about them. Anything not listed is our own
// malformed request (BadTopic, PayloadTooLarge, …), which fails identically on retry.
const DEAD_TOKEN_REASONS = new Set(['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic', 'ExpiredToken'])
const RETRYABLE_REASONS = new Set([
  'TooManyRequests',
  'InternalServerError',
  'ServiceUnavailable',
  'Shutdown',
  'TooManyProviderTokenUpdates'
])
// Fixed by minting a new provider token, which the next attempt does.
const PROVIDER_TOKEN_REASONS = new Set(['ExpiredProviderToken', 'InvalidProviderToken', 'MissingProviderToken'])

export function classifyApnsResponse(
  status: number,
  reason: string | undefined
): { errorCode: string; retryable: boolean; tokenIsDead: boolean } {
  const errorCode = reason || `HTTP_${status}`
  if (DEAD_TOKEN_REASONS.has(errorCode)) {
    return { errorCode, retryable: false, tokenIsDead: true }
  }
  if (RETRYABLE_REASONS.has(errorCode) || PROVIDER_TOKEN_REASONS.has(errorCode)) {
    return { errorCode, retryable: true, tokenIsDead: false }
  }
  const retryable = status === 429 || status >= 500
  return { errorCode, retryable, tokenIsDead: false }
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

/** ES256 provider token: `iss` is the Team ID, `kid` the Key ID shown in the portal. */
export function buildProviderToken(key: KeyObject, keyId: string, teamId: string, issuedAtSeconds: number): string {
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: keyId }))
  const claims = base64url(JSON.stringify({ iss: teamId, iat: issuedAtSeconds }))
  const signingInput = `${header}.${claims}`
  // JWS wants the raw r||s pair; node:crypto emits a DER envelope unless told otherwise.
  const signature = sign('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' })
  return `${signingInput}.${base64url(signature)}`
}

// iOS draws `aps.alert`; the client's tap handler reads the rest, same keys as the FCM data
// message. `imageUrl` is dropped: rich media needs a Notification Service Extension the client
// does not ship, and a campaign carrying an image for Android should still reach iOS.
export function buildPayload(message: PushMessage) {
  return {
    aps: {
      alert: { title: message.title, body: message.body },
      sound: 'default',
      badge: 1
    },
    deep_link: message.deepLink,
    push_id: message.pushId,
    push_campaign_id: message.campaignKey,
    category: message.category
  }
}

type ApnsResponse = { status: number; reason?: string; apnsId?: string }

export async function createApnsComponent({
  config,
  logs
}: Pick<AppComponents, 'config' | 'logs'>): Promise<IApnsComponent> {
  const logger = logs.getLogger('apns')
  const settings = await loadSettings(config)

  // Left unconfigured on purpose where iOS is not set up (dev): the service still starts, and
  // an iOS delivery fails with a code that says why instead of a retry loop.
  if (!settings) {
    logger.warn('APNS_KEY_P8 not set: iOS deliveries will fail with APNS_NOT_CONFIGURED')
    return {
      async send(): Promise<SendResult> {
        return { status: 'error', errorCode: 'APNS_NOT_CONFIGURED', retryable: false, tokenIsDead: false }
      }
    }
  }

  const { key, keyId, teamId, bundleId, host } = settings
  logger.info('APNs configured', { host, bundleId, keyId })

  let session: http2.ClientHttp2Session | null = null
  let providerToken: { value: string; mintedAt: number } | null = null

  function getSession(): http2.ClientHttp2Session {
    if (session && !session.closed && !session.destroyed) {
      return session
    }
    const next = http2.connect(host)
    next.on('error', (error) => {
      logger.warn('APNs session error', { error: error.message })
    })
    next.on('close', () => {
      if (session === next) {
        session = null
      }
    })
    session = next
    return next
  }

  function currentProviderToken(): string {
    const now = Date.now()
    if (!providerToken || now - providerToken.mintedAt > PROVIDER_TOKEN_TTL_MS) {
      providerToken = { value: buildProviderToken(key, keyId, teamId, Math.floor(now / 1000)), mintedAt: now }
    }
    return providerToken.value
  }

  function request(message: PushMessage): Promise<ApnsResponse> {
    return new Promise((resolve, reject) => {
      const nowSeconds = Math.floor(Date.now() / 1000)
      const stream = getSession().request({
        ':method': 'POST',
        ':path': `/3/device/${message.token}`,
        'content-type': 'application/json',
        authorization: `bearer ${currentProviderToken()}`,
        'apns-topic': bundleId,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'apns-expiration': String(nowSeconds + message.ttlSeconds),
        // One notification per campaign per device. Not push_id: Apple caps this header at
        // 64 bytes and push_id is longer; campaign_key is bounded to 64 by its constraint.
        'apns-collapse-id': message.campaignKey
      })

      let status = 0
      let apnsId: string | undefined
      const chunks: Buffer[] = []

      stream.setTimeout(SEND_TIMEOUT_MS, () => {
        stream.close(http2.constants.NGHTTP2_CANCEL)
        reject(new Error(`timeout after ${SEND_TIMEOUT_MS}ms`))
      })
      stream.on('response', (headers) => {
        status = Number(headers[':status'])
        apnsId = headers['apns-id'] as string | undefined
      })
      stream.on('data', (chunk: Buffer) => chunks.push(chunk))
      stream.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let reason: string | undefined
        if (text) {
          try {
            reason = JSON.parse(text).reason
          } catch {
            // A body Apple did not shape as JSON: the status alone decides below.
          }
        }
        resolve({ status, reason, apnsId })
      })
      stream.on('error', reject)
      stream.end(JSON.stringify(buildPayload(message)))
    })
  }

  async function send(message: PushMessage): Promise<SendResult> {
    let response: ApnsResponse
    try {
      response = await request(message)
    } catch (error: any) {
      // Stream reset, session gone, timeout: nothing was delivered and nothing says the token
      // is bad. Drop the session so the next attempt starts from a fresh connection.
      logger.warn('APNs send failed', { pushId: message.pushId, error: error?.message ?? String(error) })
      session?.destroy()
      session = null
      return { status: 'error', errorCode: 'TRANSPORT', retryable: true, tokenIsDead: false }
    }

    if (response.status === 200) {
      return { status: 'sent', providerMsgId: response.apnsId ?? '' }
    }

    const classified = classifyApnsResponse(response.status, response.reason)
    if (PROVIDER_TOKEN_REASONS.has(classified.errorCode)) {
      providerToken = null
    }
    logger.debug('APNs send refused', {
      campaignKey: message.campaignKey,
      pushId: message.pushId,
      status: response.status,
      errorCode: classified.errorCode,
      retryable: String(classified.retryable)
    })
    return { status: 'error', ...classified }
  }

  async function stop() {
    session?.close()
    session = null
  }

  return { send, stop }
}

type ApnsSettings = { key: KeyObject; keyId: string; teamId: string; bundleId: string; host: string }

// Same convention as FCM_SA_JSON: base64 of the file, because deploy environments only expose
// .env to the application and never a credentials file.
async function loadSettings(config: AppComponents['config']): Promise<ApnsSettings | null> {
  const raw = (await config.getString('APNS_KEY_P8'))?.trim()
  if (!raw) {
    return null
  }
  let key: KeyObject
  try {
    key = createPrivateKey(Buffer.from(raw, 'base64').toString('utf8'))
  } catch (e: any) {
    throw new Error(`APNS_KEY_P8 is not a base64-encoded PEM private key: ${e.message || e}`)
  }
  if (key.asymmetricKeyType !== 'ec') {
    throw new Error(`APNS_KEY_P8 must be an EC (P-256) key, got ${key.asymmetricKeyType}`)
  }
  const keyId = await config.requireString('APNS_KEY_ID')
  const teamId = await config.requireString('APNS_TEAM_ID')
  const bundleId = (await config.getString('APNS_BUNDLE_ID')) || DEFAULT_BUNDLE_ID
  const environment = (await config.getString('APNS_ENVIRONMENT')) || 'production'
  if (environment !== 'production' && environment !== 'sandbox') {
    throw new Error(`APNS_ENVIRONMENT must be 'production' or 'sandbox', got '${environment}'`)
  }
  return { key, keyId, teamId, bundleId, host: environment === 'sandbox' ? SANDBOX_HOST : PRODUCTION_HOST }
}
