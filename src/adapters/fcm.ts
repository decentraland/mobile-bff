// Firebase Cloud Messaging, HTTP v1.
//
// Same shape as play-integrity.ts: a service account from base64 env, exchanged for OAuth2
// tokens by google.auth.GoogleAuth. `firebase-admin` is deliberately not a dependency —
// googleapis is already here, and the Admin SDK would pull in a second auth stack to call
// one REST endpoint.
//
// Messages are sent **data-only**, with no `notification` block. That is what makes the
// Android client's DclFirebaseMessagingService run in every app state; a `notification`
// block is drawn by the system whenever the app is not in the foreground, and
// onMessageReceived never fires, taking the channel, the de-duplication and the deep link
// out of the client's hands.
//
// There is no batch endpoint to use: /batch was retired on 2024-06-21 and sendMulticast was
// removed in firebase-admin v13. It is one HTTP request per token, which is why the
// dispatcher sends with a bounded pool instead of one big call.
//
// Spec: https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages/send

import { google } from 'googleapis'
import { AppComponents } from '../types'

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'
const SEND_TIMEOUT_MS = 10_000

export type PushMessage = {
  token: string
  /** Unique per delivery; the client de-duplicates on it. */
  pushId: string
  campaignKey: string
  title: string
  body: string
  deepLink: string
  imageUrl: string | null
  category: string
  ttlSeconds: number
}

// Discriminated by a string rather than a boolean `ok`: the test tsconfig does not enable
// strict mode, and without strictNullChecks a boolean-literal discriminant does not narrow,
// so every consumer would need a cast to read the failure fields.
export type SendResult =
  | { status: 'sent'; providerMsgId: string }
  | { status: 'error'; errorCode: string; retryable: boolean; tokenIsDead: boolean }

export type IFcmComponent = {
  send(message: PushMessage): Promise<SendResult>
}

// FCM's documented error codes, split by what we should do about them.
//
// UNREGISTERED and INVALID_ARGUMENT are the ones that matter for cost: the app was
// uninstalled or the token was never valid, and retrying is pure waste. They go to
// push_dead_tokens so the next audience skips them.
const DEAD_TOKEN_CODES = new Set(['UNREGISTERED', 'INVALID_ARGUMENT', 'SENDER_ID_MISMATCH'])
const RETRYABLE_CODES = new Set(['UNAVAILABLE', 'INTERNAL', 'QUOTA_EXCEEDED'])

/** Pull FCM's `error.details[].errorCode` out of a googleapis error, falling back to status. */
export function classifyError(error: any): { errorCode: string; retryable: boolean; tokenIsDead: boolean } {
  const details: any[] = error?.response?.data?.error?.details ?? error?.errors ?? []
  const fcmDetail = Array.isArray(details)
    ? details.find((d) => typeof d?.errorCode === 'string')
    : undefined
  const status: string | undefined = error?.response?.data?.error?.status
  const httpCode: number | undefined = error?.response?.status ?? error?.code

  const errorCode = fcmDetail?.errorCode ?? status ?? (httpCode ? `HTTP_${httpCode}` : 'UNKNOWN')

  if (DEAD_TOKEN_CODES.has(errorCode)) {
    return { errorCode, retryable: false, tokenIsDead: true }
  }
  if (RETRYABLE_CODES.has(errorCode)) {
    return { errorCode, retryable: true, tokenIsDead: false }
  }
  // 429 and 5xx are worth another attempt even when FCM did not name a code; a 4xx that is
  // not a known dead-token case is our own bad request and will fail identically on retry.
  const retryable = typeof httpCode === 'number' && (httpCode === 429 || httpCode >= 500)
  return { errorCode, retryable, tokenIsDead: false }
}

export async function createFcmComponent({
  config,
  logs
}: Pick<AppComponents, 'config' | 'logs'>): Promise<IFcmComponent> {
  const logger = logs.getLogger('fcm')
  const credentials = await loadServiceAccountCredentials(config)
  const projectId = credentials.project_id

  const auth = new google.auth.GoogleAuth({ credentials, scopes: [FCM_SCOPE] })
  const client = google.fcm({ version: 'v1', auth })

  async function send(message: PushMessage): Promise<SendResult> {
    try {
      const response = await client.projects.messages.send(
        {
          parent: `projects/${projectId}`,
          requestBody: {
            message: {
              token: message.token,
              // Every value must be a string: FCM rejects non-string data fields.
              data: {
                v: '1',
                push_id: message.pushId,
                category: message.category,
                title: message.title,
                body: message.body,
                deep_link: message.deepLink,
                ...(message.imageUrl ? { image_url: message.imageUrl } : {})
              },
              android: {
                // HIGH is required for the service to be started while the device is dozing.
                // At NORMAL, Doze holds the message until the next maintenance window, which
                // for a re-engagement push means arriving hours after it was relevant.
                priority: 'HIGH',
                ttl: `${message.ttlSeconds}s`
              }
            }
          }
        },
        { timeout: SEND_TIMEOUT_MS }
      )

      const providerMsgId = response?.data?.name
      if (!providerMsgId) {
        // A 200 with no name should not happen; treat it as retryable rather than
        // recording a send we cannot point at anything.
        return { status: 'error', errorCode: 'NO_MESSAGE_NAME', retryable: true, tokenIsDead: false }
      }
      return { status: 'sent', providerMsgId }
    } catch (error: any) {
      const classified = classifyError(error)
      logger.debug('FCM send failed', {
        campaignKey: message.campaignKey,
        pushId: message.pushId,
        errorCode: classified.errorCode,
        retryable: String(classified.retryable)
      })
      return { status: 'error', ...classified }
    }
  }

  return { send }
}

// Mirrors play-integrity.ts: base64 of the GCP-issued JSON, because most deploy environments
// only expose .env to the application and never a credentials file. project_id is read from
// the key itself so the send URL cannot drift from the account signing for it.
async function loadServiceAccountCredentials(
  config: AppComponents['config']
): Promise<{ client_email: string; private_key: string; project_id: string }> {
  const raw = await config.requireString('FCM_SA_JSON')
  let jsonText: string
  try {
    jsonText = Buffer.from(raw.trim(), 'base64').toString('utf8')
  } catch (e: any) {
    throw new Error(`FCM_SA_JSON is not valid base64: ${e.message || e}`)
  }
  let parsed: any
  try {
    parsed = JSON.parse(jsonText)
  } catch (e: any) {
    throw new Error(`FCM_SA_JSON could not be parsed as JSON: ${e.message || e}`)
  }
  for (const field of ['client_email', 'private_key', 'project_id']) {
    if (typeof parsed[field] !== 'string') {
      throw new Error(`FCM_SA_JSON missing ${field}`)
    }
  }
  return {
    client_email: parsed.client_email,
    private_key: parsed.private_key,
    project_id: parsed.project_id
  }
}
