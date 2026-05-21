import { HandlerContextWithPath } from '../../../types'
import { AppAttestError } from '../../../adapters/app-attest'
import { PlayIntegrityError } from '../../../adapters/play-integrity'

// POST /v1/attest/check — non-gating verdict endpoint.
//
// The client sends the SAME headers + raw body it uses for sign-message; we
// run the platform attestation verification and report the outcome in the
// response. ALWAYS returns 200 — analytics downstream parses the body shape
// to compute pass rates. Failing here is informational, not user-facing.
//
// Response shape:
//   {
//     ok: boolean,
//     platform: "ios" | "android" | "unknown",
//     code: "OK" | "<ATTESTATION_*>",
//     error?: string,
//     verdicts?: string[],            // Android only, on success
//     details?: unknown,              // platform-specific extras
//     elapsed_ms: number
//   }
export async function attestCheckHandler(
  context: HandlerContextWithPath<
    'appAttest' | 'playIntegrity' | 'attestationState' | 'logs',
    '/v1/attest/check'
  >
) {
  const {
    components: { appAttest, playIntegrity, attestationState, logs },
    request
  } = context
  const logger = logs.getLogger('attest-check')
  const start = Date.now()

  const headers = request.headers
  const platformRaw = headers.get('x-attest-platform')

  // We always read the body — for iOS it's part of the signed payload, for
  // Android it's part of the requestHash binding.
  let rawBody: Buffer
  try {
    rawBody = Buffer.from(await request.arrayBuffer())
  } catch {
    rawBody = Buffer.alloc(0)
  }

  function ok(extra: Record<string, unknown>): { status: number; body: Record<string, unknown> } {
    const elapsed = Date.now() - start
    return { status: 200, body: { ok: true, platform: platformRaw || 'unknown', code: 'OK', elapsed_ms: elapsed, ...extra } }
  }

  function fail(code: string, error: string, details?: unknown): { status: number; body: Record<string, unknown> } {
    const elapsed = Date.now() - start
    return {
      status: 200,
      body: {
        ok: false,
        platform: platformRaw || 'unknown',
        code,
        error,
        ...(details ? { details } : {}),
        elapsed_ms: elapsed
      }
    }
  }

  if (!platformRaw) {
    return fail('ATTESTATION_MISSING', 'missing x-attest-platform header')
  }

  if (platformRaw === 'ios') {
    const keyIdB64u = headers.get('x-attest-key-id')
    const assertionB64u = headers.get('x-attest-assertion')
    const nonceB64u = headers.get('x-attest-nonce')
    if (!keyIdB64u || !assertionB64u || !nonceB64u) {
      return fail(
        'ATTESTATION_IOS_BAD_ASSERTION',
        'x-attest-key-id, x-attest-assertion, x-attest-nonce all required'
      )
    }
    const stored = attestationState.getRegisteredKey(keyIdB64u)
    if (!stored) {
      return fail(
        'ATTESTATION_IOS_KEY_NOT_REGISTERED',
        'key_id has not completed registration — call /v1/attest/ios/register first'
      )
    }
    let nonceBytes: Buffer
    try {
      nonceBytes = Buffer.from(nonceB64u, 'base64url')
    } catch {
      return fail('ATTESTATION_IOS_BAD_ASSERTION', 'x-attest-nonce is not base64url')
    }
    try {
      const { newCounter } = appAttest.verifyAssertion({
        assertionB64u,
        nonceBytes,
        rawBody,
        storedPublicKeyPem: stored.publicKeyPem,
        storedCounter: stored.counter
      })
      attestationState.updateKeyCounter(keyIdB64u, newCounter)
      logger.info('ios attest ok', { key_id_prefix: keyIdB64u.slice(0, 8) })
      return ok({ key_id_prefix: keyIdB64u.slice(0, 8) })
    } catch (e: any) {
      const isReplay = e instanceof AppAttestError && /counter replay/.test(e.message)
      const code = isReplay ? 'ATTESTATION_IOS_COUNTER_REPLAY' : 'ATTESTATION_IOS_BAD_ASSERTION'
      const msg = e?.message || String(e)
      logger.warn('ios attest failed', { key_id_prefix: keyIdB64u.slice(0, 8), code, error: msg })
      return fail(code, msg)
    }
  }

  if (platformRaw === 'android') {
    const integrityToken = headers.get('x-attest-integrity-token')
    if (!integrityToken) {
      return fail('ATTESTATION_ANDROID_INVALID_TOKEN', 'x-attest-integrity-token header required')
    }
    try {
      const { payload } = await playIntegrity.verifyIntegrityToken({ integrityToken, rawBody })
      const verdicts = payload.deviceIntegrity?.deviceRecognitionVerdict ?? []
      logger.info('android attest ok', { verdicts: verdicts.join(',') })
      return ok({ verdicts })
    } catch (e: any) {
      if (e instanceof PlayIntegrityError) {
        logger.warn('android attest failed', { code: e.code, error: e.message })
        return fail(e.code, e.message, e.extra)
      }
      const msg = e?.message || String(e)
      logger.warn('android attest unexpected error', { error: msg })
      return fail('ATTESTATION_ANDROID_INVALID_TOKEN', `unexpected: ${msg}`)
    }
  }

  return fail('ATTESTATION_UNKNOWN_PLATFORM', `x-attest-platform must be 'ios' or 'android', got '${platformRaw}'`)
}
