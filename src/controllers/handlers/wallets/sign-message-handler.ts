import { HandlerContextWithPath } from '../../../types'
import { clientKeyFromHeaders } from '../../../adapters/rate-limiter'
import { RL_SIGN_MESSAGE, withFallbackCap } from '../../../logic/rate-limit-rules'

// POST /wallets/sign-message — thin proxy to Thirdweb's sign-message, gated by
// platform attestation. The user's `Authorization: Bearer <jwt>` flows
// through; the server-only `x-secret-key` is injected by the thirdweb-proxy
// adapter.
//
// Attestation gate: the client must send the standard x-attest-* headers (the
// same ones consumed by /attest/check). A failed verdict returns 401 with the
// attestation `code` in the body, so the client can decide whether to retry
// (e.g. re-enrollment on ATTESTATION_IOS_KEY_NOT_REGISTERED). The "validated
// once per install version" marker on the client side does NOT remove the
// per-call attestation here — each sign-message body needs its own assertion
// bound to those exact bytes.
//
// Rate limited per IP. The attestation gate already burns one paid upstream
// call (Play Integrity / verifyAssertion + CAS write) per attempt, so even
// failed sign-messages consume real resources; cap before we even look at
// the headers.
export async function signMessageHandler(
  context: HandlerContextWithPath<
    'thirdwebProxy' | 'attestationVerifier' | 'rateLimiter' | 'logs',
    '/wallets/sign-message'
  >
) {
  const {
    components: { thirdwebProxy, attestationVerifier, rateLimiter, logs },
    request
  } = context
  const logger = logs.getLogger('sign-message')

  const { key: ipKey, isFallback } = clientKeyFromHeaders(request.headers, logs.getLogger('rate-limit'))
  const rl = rateLimiter.check(
    withFallbackCap(RL_SIGN_MESSAGE, isFallback),
    `sign-message:${ipKey}`,
    'wallets:sign-message'
  )
  if (!rl.allowed) {
    const retryHeaders: Record<string, string> = { 'Retry-After': String(rl.retryAfterSec) }
    return {
      status: 429,
      headers: retryHeaders,
      body: { error: 'rate limit exceeded' }
    }
  }

  const authorization = request.headers.get('authorization') || ''
  if (!authorization.toLowerCase().startsWith('bearer ')) {
    // Log the first few characters of the rejected header so client
    // misconfigurations (`Token <jwt>`, lowercase `bearer<jwt>`, missing
    // space, etc.) are debuggable from server logs without leaking the
    // actual credential.
    logger.warn('sign-message rejected: missing Bearer prefix', {
      authorization_prefix: authorization.slice(0, 16),
      had_header: String(authorization.length > 0)
    })
    return { status: 401, body: { error: 'missing Authorization: Bearer <jwt>' } }
  }

  const rawBody = Buffer.from(await request.arrayBuffer())

  const outcome = await attestationVerifier.verify({ headers: request.headers, rawBody })
  if (!outcome.ok) {
    logger.warn('sign-message blocked by attestation', {
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

  const upstream = await thirdwebProxy.forwardSignMessage({ authorization, rawBody })
  logger.info('forwarded', {
    status: upstream.status,
    platform: outcome.platform,
    key_id_prefix: outcome.keyIdPrefix ?? ''
  })

  const responseHeaders: Record<string, string> | undefined = upstream.contentType
    ? { 'Content-Type': upstream.contentType }
    : undefined
  return {
    status: upstream.status,
    headers: responseHeaders,
    body: upstream.body
  }
}
