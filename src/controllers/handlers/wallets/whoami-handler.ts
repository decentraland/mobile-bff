import { HandlerContextWithPath } from '../../../types'

// GET /wallets/whoami — decode an `Authorization: Bearer <jwt>` and report its
// expiration. No attestation required, no upstream call. We do not verify the
// signature here: we don't hold Thirdweb's public key. The endpoint is a
// convenience for clients that want to know how long their session is good
// for before kicking off the attestation/sign-message dance.
export async function whoamiHandler(
  context: HandlerContextWithPath<'logs', '/wallets/whoami'>
) {
  const {
    components: { logs },
    request
  } = context
  const logger = logs.getLogger('whoami')

  const authorization = request.headers.get('authorization') || ''
  if (!authorization.toLowerCase().startsWith('bearer ')) {
    return { status: 401, body: { error: 'missing Authorization: Bearer <jwt>' } }
  }

  const token = authorization.slice(7).trim()
  const parts = token.split('.')
  if (parts.length !== 3) {
    return { status: 401, body: { error: 'malformed JWT' } }
  }

  let payload: Record<string, unknown>
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const parsed = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('payload is not a JSON object')
    }
    payload = parsed as Record<string, unknown>
  } catch (err: any) {
    logger.warn('whoami rejected: payload decode failed', { error: err?.message || String(err) })
    return { status: 401, body: { error: 'malformed JWT payload' } }
  }

  const exp = typeof payload.exp === 'number' ? payload.exp : null
  if (exp === null) {
    return { status: 401, body: { error: 'JWT missing exp claim' } }
  }
  const iat = typeof payload.iat === 'number' ? payload.iat : null
  const sub = typeof payload.sub === 'string' ? payload.sub : null

  const nowSec = Math.floor(Date.now() / 1000)
  const secondsRemaining = exp - nowSec

  return {
    status: 200,
    body: {
      active: secondsRemaining > 0,
      sub,
      exp,
      expiresAt: new Date(exp * 1000).toISOString(),
      iat,
      issuedAt: iat !== null ? new Date(iat * 1000).toISOString() : null,
      secondsRemaining
    }
  }
}
