import { HandlerContextWithPath } from '../../../types'
import { clientKeyFromHeaders } from '../../../adapters/rate-limiter'
import { RL_ATTEST_SESSION, withFallbackCap } from '../../../logic/rate-limit-rules'

// POST /attest/session — verify platform attestation, then issue a session
// token the client can replay on subsequent /wallets/sign-message calls.
//
// The attestation here IS body-bound (same verifier as /attest/check
// uses, against the exact bytes of THIS request). What's NOT bound to a
// body is the issued token — it sits in the client's memory and is sent
// verbatim on each /sign-message call. The point is to keep Play
// Integrity calls bounded to one per session rather than one per signed
// message.
//
// Rate-limited per IP: every call still pays one upstream Play Integrity
// verdict on Android.
export async function attestSessionHandler(
  context: HandlerContextWithPath<
    'attestationVerifier' | 'attestationSession' | 'rateLimiter' | 'logs',
    '/attest/session'
  >
) {
  const {
    components: { attestationVerifier, attestationSession, rateLimiter, logs },
    request
  } = context
  const logger = logs.getLogger('attest-session')

  const { key: ipKey, isFallback } = clientKeyFromHeaders(request.headers, logs.getLogger('rate-limit'))
  const rl = rateLimiter.check(
    withFallbackCap(RL_ATTEST_SESSION, isFallback),
    `attest:session:${ipKey}`,
    'attest:session'
  )
  if (!rl.allowed) {
    return {
      status: 429,
      headers: { 'Retry-After': String(rl.retryAfterSec) },
      body: { error: 'rate limit exceeded' }
    }
  }

  const rawBody = Buffer.from(await request.arrayBuffer())
  const outcome = await attestationVerifier.verify({ headers: request.headers, rawBody })
  if (!outcome.ok) {
    logger.warn('attest session denied', {
      code: outcome.code,
      platform: outcome.platform,
      key_id_prefix: outcome.keyIdPrefix ?? ''
    })
    return {
      status: 401,
      body: {
        error: outcome.error,
        code: outcome.code,
        platform: outcome.platform,
        ...(outcome.details ? { details: outcome.details } : {})
      }
    }
  }

  const { token, expiresAt } = attestationSession.issue({ platform: outcome.platform })
  logger.info('attest session issued', { platform: outcome.platform })
  return {
    status: 200,
    body: {
      token,
      expires_at: new Date(expiresAt).toISOString()
    }
  }
}
