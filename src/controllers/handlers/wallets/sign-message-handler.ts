import { HandlerContextWithPath } from '../../../types'

// Thin proxy in front of Thirdweb's sign-message — the Authorization Bearer
// JWT is forwarded verbatim, the x-secret-key (server-only) is injected by
// the thirdweb-proxy adapter. No attestation gate here: platform integrity
// is reported separately via POST /v1/attest/check.
export async function signMessageHandler(
  context: HandlerContextWithPath<'thirdwebProxy' | 'logs', '/v1/wallets/sign-message'>
) {
  const {
    components: { thirdwebProxy, logs },
    request
  } = context
  const logger = logs.getLogger('sign-message')

  const authorization = request.headers.get('authorization') || ''
  if (!authorization.toLowerCase().startsWith('bearer ')) {
    return { status: 401, body: { error: 'missing Authorization: Bearer <jwt>' } }
  }

  const rawBody = Buffer.from(await request.arrayBuffer())

  const upstream = await thirdwebProxy.forwardSignMessage({ authorization, rawBody })
  logger.info('forwarded', { status: upstream.status })

  return {
    status: upstream.status,
    headers: upstream.contentType ? { 'Content-Type': upstream.contentType } : undefined,
    body: upstream.body
  }
}
