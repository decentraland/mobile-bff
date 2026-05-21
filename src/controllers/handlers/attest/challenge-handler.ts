import { HandlerContextWithPath } from '../../../types'
import { clientKeyFromHeaders } from '../../../adapters/rate-limiter'
import { RL_ATTEST_CHALLENGE, withFallbackCap } from '../../../logic/rate-limit-rules'

// POST /attest/ios/challenge — mint a server-signed challenge for the App
// Attest enrollment ceremony.
//
// The challenge is an HMAC-signed blob containing a random nonce and an
// expiration timestamp (see `app-attest.ts::issueChallenge`). No DB is
// touched — verification on the way back recomputes the HMAC. This means
// challenges are technically replayable within their TTL window, but the
// attestation_object Apple produces is bound to the exact challenge bytes
// (and to the per-session ephemeral key), so a replay within TTL would
// only yield the same outcome as a fresh ceremony.
//
// Rate limited per IP because issuance is anonymous and we want a buggy
// client retry loop to fall off a cliff before it floods analytics.
export async function attestIosChallengeHandler(
  context: HandlerContextWithPath<'appAttest' | 'rateLimiter' | 'logs', '/attest/ios/challenge'>
) {
  const {
    components: { appAttest, rateLimiter, logs },
    request
  } = context
  const { key: ipKey, isFallback } = clientKeyFromHeaders(request.headers, logs.getLogger('rate-limit'))
  const rl = rateLimiter.check(
    withFallbackCap(RL_ATTEST_CHALLENGE, isFallback),
    `attest:challenge:${ipKey}`,
    'attest:challenge'
  )
  if (!rl.allowed) {
    return {
      status: 429,
      headers: { 'Retry-After': String(rl.retryAfterSec) },
      body: { error: 'rate limit exceeded' }
    }
  }
  const { challenge, expiresAt } = appAttest.issueChallenge()
  return { status: 200, body: { challenge, expires_at: expiresAt } }
}
