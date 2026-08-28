import { DecentralandSignatureContext } from '@dcl/crypto-middleware'
import { HandlerContextWithPath } from '../../../types'
import { isAllowedUser } from '../../../logic/allowed-users'

/**
 * Permission probe. Answers "is this signer allowed to use the backoffice?"
 * without touching any resource, so clients can gate their UI up front instead
 * of discovering a 403 on the first write.
 *
 * Deliberately returns 200 with `allowed: false` rather than 403, so callers can
 * tell "not allowed" apart from "the request failed".
 */
export async function getBackofficeMeHandler(
  context: HandlerContextWithPath<'config', '/backoffice/me'> & DecentralandSignatureContext<any>
) {
  const {
    components: { config },
    verification
  } = context

  const userAddress = verification?.auth

  if (!userAddress) {
    return { status: 401, body: { ok: false, error: 'Unauthorized' } }
  }

  return {
    status: 200,
    body: {
      ok: true,
      data: {
        address: userAddress,
        allowed: await isAllowedUser(config, userAddress)
      }
    }
  }
}
