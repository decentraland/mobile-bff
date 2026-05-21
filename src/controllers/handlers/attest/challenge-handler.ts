import { HandlerContextWithPath } from '../../../types'
import { clientKeyFromHeaders } from '../../../adapters/rate-limiter'
import { RL_ATTEST_CHALLENGE } from '../../../logic/rate-limit-rules'

// POST /attest/ios/challenge — issue a random one-shot challenge that the
// client uses as part of the App Attest enrollment ceremony.
//
// Rate limited per IP: the endpoint writes a row per call (and GC's another
// on the way in), so an unbounded caller could push tail latency / disk
// usage. The limit is much higher than legitimate use — registration is
// one-shot per install.
export async function attestIosChallengeHandler(
  context: HandlerContextWithPath<'attestationState' | 'rateLimiter', '/attest/ios/challenge'>
) {
  const {
    components: { attestationState, rateLimiter },
    request
  } = context
  const ipKey = clientKeyFromHeaders(request.headers)
  const rl = rateLimiter.check(RL_ATTEST_CHALLENGE, `attest:challenge:${ipKey}`, 'attest:challenge')
  if (!rl.allowed) {
    return {
      status: 429,
      headers: { 'Retry-After': String(rl.retryAfterSec) },
      body: { error: 'rate limit exceeded' }
    }
  }
  const { challenge, expiresAt } = await attestationState.issueChallenge()
  return { status: 200, body: { challenge, expires_at: expiresAt } }
}
