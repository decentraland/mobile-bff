import { HandlerContextWithPath } from '../../../types'
import { clientKeyFromHeaders } from '../../../adapters/rate-limiter'
import { RL_ATTEST_CHECK, withFallbackCap } from '../../../logic/rate-limit-rules'

// POST /attest/check — non-gating verdict endpoint.
//
// The client sends the SAME headers + raw body it uses for sign-message; we
// run the platform attestation verification and report the outcome in the
// response. ALWAYS returns 200 — analytics downstream parses the body shape
// to compute pass rates. Failing here is informational, not user-facing.
//
// Rate limited per IP because verify() on Android triggers a paid call to
// Google Play Integrity API; without a cap an anonymous script can drain
// the daily quota.
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
  context: HandlerContextWithPath<'attestationVerifier' | 'rateLimiter' | 'logs', '/attest/check'>
) {
  const {
    components: { attestationVerifier, rateLimiter, logs },
    request
  } = context
  const start = Date.now()
  const logger = logs.getLogger('attest-check')

  const { key: ipKey, isFallback } = clientKeyFromHeaders(request.headers, logs.getLogger('rate-limit'))
  const rl = rateLimiter.check(
    withFallbackCap(RL_ATTEST_CHECK, isFallback),
    `attest:check:${ipKey}`,
    'attest:check'
  )
  if (!rl.allowed) {
    return {
      status: 429,
      headers: { 'Retry-After': String(rl.retryAfterSec) },
      body: { error: 'rate limit exceeded' }
    }
  }

  let rawBody: Buffer
  try {
    rawBody = Buffer.from(await request.arrayBuffer())
  } catch (e: any) {
    // Reading the body should not fail on a well-formed HTTP request — if
    // it does, the request is malformed (truncated, bad framing, client
    // disconnect mid-stream). Surface this directly instead of running the
    // verifier with an empty body, which would always be a "missing
    // headers" outcome and mask the real failure mode.
    logger.warn('failed to read request body', { error: e?.message || String(e) })
    return {
      status: 200,
      body: {
        ok: false,
        platform: 'unknown',
        code: 'ATTESTATION_BAD_REQUEST_BODY',
        error: 'could not read request body',
        elapsed_ms: Date.now() - start
      }
    }
  }

  const outcome = await attestationVerifier.verify({ headers: request.headers, rawBody })
  const body: Record<string, unknown> = {
    ok: outcome.ok,
    platform: outcome.platform,
    code: outcome.code,
    elapsed_ms: Date.now() - start
  }
  if (outcome.error !== undefined) body.error = outcome.error
  if (outcome.details !== undefined) body.details = outcome.details
  if (outcome.verdicts !== undefined) body.verdicts = outcome.verdicts
  if (outcome.keyIdPrefix !== undefined) body.key_id_prefix = outcome.keyIdPrefix
  return { status: 200, body }
}
