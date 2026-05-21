// Google Play Integrity verification.
//
// The client requests an integrity token from Play Integrity with
//   requestHash = base64url(SHA256(<raw request body bytes>))   [Classic API
//                                                                stores it in
//                                                                requestDetails.nonce]
// We then exchange that token via the server-to-server decodeIntegrityToken
// REST endpoint (authenticated with a service account on the project that
// owns the Android app) and validate the resulting verdict.
//
// Spec: https://developer.android.com/google/play/integrity/verdicts

import crypto from 'node:crypto'
import { google, playintegrity_v1 } from 'googleapis'

import { AppComponents } from '../types'

// Five minutes of clock skew tolerance. The token is body-bound by SHA256, so
// a stale replay still has to match the exact request body; the freshness
// window only limits opportunistic re-use on mobile networks with slow
// round-trips.
const FRESHNESS_MS = 5 * 60 * 1000

export class PlayIntegrityError extends Error {
  code: string
  extra?: unknown
  constructor(code: string, message: string, extra?: unknown) {
    super(message)
    this.name = 'PlayIntegrityError'
    this.code = code
    this.extra = extra
  }
}

export type IPlayIntegrityComponent = {
  verifyIntegrityToken(input: {
    integrityToken: string
    rawBody: Buffer
  }): Promise<{ payload: playintegrity_v1.Schema$TokenPayloadExternal }>
}

export async function createPlayIntegrityComponent({
  config
}: Pick<AppComponents, 'config'>): Promise<IPlayIntegrityComponent> {
  const packageName = await config.requireString('PLAY_INTEGRITY_PACKAGE_NAME')
  const requiredVerdictsRaw = (await config.getString('PLAY_INTEGRITY_REQUIRED_VERDICTS')) ?? 'MEETS_STRONG_INTEGRITY'
  const requiredVerdicts = requiredVerdictsRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (requiredVerdicts.length === 0) {
    throw new Error('PLAY_INTEGRITY_REQUIRED_VERDICTS must list at least one verdict')
  }

  // Service-account credentials come from PLAY_INTEGRITY_SA_JSON: base64 of the
  // GCP-issued JSON. We avoid the file-path mode entirely because most deploy
  // environments only expose .env to the application.
  const credentials = await loadServiceAccountCredentials(config)
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/playintegrity']
  })
  const client = google.playintegrity({ version: 'v1', auth })

  async function verifyIntegrityToken({
    integrityToken,
    rawBody
  }: {
    integrityToken: string
    rawBody: Buffer
  }): Promise<{ payload: playintegrity_v1.Schema$TokenPayloadExternal }> {
    let decoded
    try {
      decoded = await client.v1.decodeIntegrityToken({
        packageName,
        requestBody: { integrityToken }
      })
    } catch (e: any) {
      throw new PlayIntegrityError(
        'ATTESTATION_ANDROID_INVALID_TOKEN',
        `decodeIntegrityToken failed: ${e.message || e}`
      )
    }

    const payload = decoded && decoded.data && decoded.data.tokenPayloadExternal
    if (!payload) {
      throw new PlayIntegrityError(
        'ATTESTATION_ANDROID_INVALID_TOKEN',
        'decodeIntegrityToken returned no tokenPayloadExternal'
      )
    }

    const reqDetails = payload.requestDetails || {}
    if (reqDetails.requestPackageName !== packageName) {
      throw new PlayIntegrityError(
        'ATTESTATION_ANDROID_PACKAGE_MISMATCH',
        `token packageName=${reqDetails.requestPackageName} expected=${packageName}`
      )
    }

    // Body-binding check — the token must be tied to *this* request body.
    //
    // The body hash lands in different fields depending on which Play
    // Integrity API the client used:
    //   - Classic API (IntegrityManagerFactory.create + setNonce):  `nonce`
    //   - Standard API (StandardIntegrityManager + setRequestHash): `requestHash`
    // We accept either, so the same backend works regardless of which API the
    // Android plugin uses.
    const expectedHash = crypto.createHash('sha256').update(rawBody).digest()
    const tokenHashField = reqDetails.nonce || reqDetails.requestHash
    const tokenHashBytes = decodeFlexibleBase64(tokenHashField)
    const matchesB64 = !!tokenHashBytes && tokenHashBytes.length > 0 && tokenHashBytes.equals(expectedHash)
    const matchesHex =
      typeof tokenHashField === 'string' && tokenHashField.toLowerCase() === expectedHash.toString('hex')
    if (!matchesB64 && !matchesHex) {
      throw new PlayIntegrityError(
        'ATTESTATION_ANDROID_HASH_MISMATCH',
        'nonce/requestHash in token does not match SHA256(request body)'
      )
    }

    // Freshness — tokens older than FRESHNESS_MS are rejected.
    const tsMs = Number(reqDetails.timestampMillis)
    if (!Number.isFinite(tsMs) || Math.abs(Date.now() - tsMs) > FRESHNESS_MS) {
      throw new PlayIntegrityError(
        'ATTESTATION_ANDROID_TOKEN_STALE',
        `token timestampMillis=${reqDetails.timestampMillis} is outside ±${FRESHNESS_MS}ms window`
      )
    }

    const appIntegrity = payload.appIntegrity || {}
    const appVerdict = appIntegrity.appRecognitionVerdict
    if (appVerdict !== 'PLAY_RECOGNIZED') {
      throw new PlayIntegrityError(
        'ATTESTATION_ANDROID_VERDICT_FAILED',
        `appRecognitionVerdict=${appVerdict}, expected PLAY_RECOGNIZED`,
        { appRecognitionVerdict: appVerdict }
      )
    }

    const deviceIntegrity = payload.deviceIntegrity || {}
    const deviceVerdicts = deviceIntegrity.deviceRecognitionVerdict || []
    const missing = requiredVerdicts.filter((v) => !deviceVerdicts.includes(v))
    if (missing.length > 0) {
      throw new PlayIntegrityError(
        'ATTESTATION_ANDROID_VERDICT_FAILED',
        `deviceRecognitionVerdict missing required values: [${missing.join(', ')}]`,
        { deviceRecognitionVerdict: deviceVerdicts, missing }
      )
    }

    return { payload }
  }

  return { verifyIntegrityToken }
}

function decodeFlexibleBase64(s: unknown): Buffer | null {
  if (typeof s !== 'string' || s.length === 0) return null
  // Buffer.from with 'base64' tolerates both standard and url-safe alphabets
  // once we normalize the url-safe substitutions back.
  const normalized = s.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(normalized, 'base64')
}

// Parses the service-account credentials from PLAY_INTEGRITY_SA_JSON. The env
// var holds the base64 of the GCP-issued service-account JSON — generate it
// with `base64 -i sa.json | tr -d '\n'`.
async function loadServiceAccountCredentials(
  config: AppComponents['config']
): Promise<{ client_email: string; private_key: string }> {
  const raw = await config.requireString('PLAY_INTEGRITY_SA_JSON')
  let jsonText: string
  try {
    jsonText = Buffer.from(raw.trim(), 'base64').toString('utf8')
  } catch (e: any) {
    throw new Error(`PLAY_INTEGRITY_SA_JSON is not valid base64: ${e.message || e}`)
  }
  let parsed: any
  try {
    parsed = JSON.parse(jsonText)
  } catch (e: any) {
    throw new Error(`PLAY_INTEGRITY_SA_JSON could not be parsed as JSON: ${e.message || e}`)
  }
  if (typeof parsed.client_email !== 'string' || typeof parsed.private_key !== 'string') {
    throw new Error('PLAY_INTEGRITY_SA_JSON missing client_email or private_key fields')
  }
  return { client_email: parsed.client_email, private_key: parsed.private_key }
}
