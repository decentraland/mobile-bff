import { HandlerContextWithPath } from '../../../types'

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
export async function signMessageHandler(
  context: HandlerContextWithPath<
    'thirdwebProxy' | 'attestationVerifier' | 'logs',
    '/wallets/sign-message'
  >
) {
  const {
    components: { thirdwebProxy, attestationVerifier, logs },
    request
  } = context
  const logger = logs.getLogger('sign-message')

  const authorization = request.headers.get('authorization') || ''
  if (!authorization.toLowerCase().startsWith('bearer ')) {
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

  return {
    status: upstream.status,
    headers: upstream.contentType ? { 'Content-Type': upstream.contentType } : undefined,
    body: upstream.body
  }
}
