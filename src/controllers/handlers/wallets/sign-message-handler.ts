import { HandlerContextWithPath } from '../../../types'
import { clientKeyFromHeaders } from '../../../adapters/rate-limiter'
import { RL_SIGN_MESSAGE, withFallbackCap } from '../../../logic/rate-limit-rules'

// POST /wallets/sign-message — thin proxy to Thirdweb's sign-message,
// gated by an attestation session token issued by POST /attest/session.
//
// The user's `Authorization: Bearer <jwt>` flows through to Thirdweb; the
// server-only `x-secret-key` is injected by the thirdweb-proxy adapter.
//
// SECURITY NOTE: the session token is NOT bound to the request body.
// Anyone with a valid (non-expired) token can sign arbitrary messages
// with this wallet's bearer JWT until the token expires. This is a
// deliberate simplification vs the per-request attestation gate the
// codebase used to enforce — see `attestation-body-binding.patch` in the
// repo root for the upgrade path that restores per-request body
// binding.
//
// Rate-limited per IP. Cheap relative to attestation but the upstream
// Thirdweb call is paid and slow, so the cap stays.
export async function signMessageHandler(
  context: HandlerContextWithPath<
    'thirdwebProxy' | 'attestationSession' | 'rateLimiter' | 'logs',
    '/wallets/sign-message'
  >
) {
  const {
    components: { thirdwebProxy, attestationSession, rateLimiter, logs },
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
    return {
      status: 429,
      headers: { 'Retry-After': String(rl.retryAfterSec) },
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

  const sessionToken = request.headers.get('x-attest-session') || ''
  if (!sessionToken) {
    return {
      status: 401,
      body: {
        error: 'missing x-attest-session header — obtain one from POST /attest/session',
        code: 'ATTESTATION_SESSION_MISSING'
      }
    }
  }
  const verification = attestationSession.verify(sessionToken)
  if (!verification.ok) {
    logger.warn('sign-message blocked by session token', { code: verification.code ?? '' })
    return {
      status: 401,
      body: {
        error: verification.error,
        code: verification.code
      }
    }
  }

  const rawBody = Buffer.from(await request.arrayBuffer())
  const upstream = await thirdwebProxy.forwardSignMessage({ authorization, rawBody })
  logger.info('forwarded', {
    status: upstream.status,
    platform: verification.payload?.platform ?? '',
    jti: verification.payload?.jti ?? ''
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
