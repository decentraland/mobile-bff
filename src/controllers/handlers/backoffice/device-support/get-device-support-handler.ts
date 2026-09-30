import { DecentralandSignatureContext } from '@dcl/crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { isAllowedUser } from '../../../../logic/allowed-users'

export async function getBackofficeDeviceSupportHandler(
  context: HandlerContextWithPath<'deviceSupportDb' | 'logs' | 'config', '/backoffice/device-support'>
    & DecentralandSignatureContext<any>
) {
  const {
    components: { deviceSupportDb, logs, config },
    verification
  } = context

  const logger = logs.getLogger('get-backoffice-device-support')
  const userAddress = verification?.auth

  if (!userAddress) {
    return { status: 401, body: { ok: false, error: 'Unauthorized' } }
  }

  if (!(await isAllowedUser(config, userAddress))) {
    return { status: 403, body: { ok: false, error: 'Forbidden: User not in allowed list' } }
  }

  try {
    const entries = await deviceSupportDb.getAll()
    return { status: 200, body: { ok: true, data: { entries } } }
  } catch (error) {
    logger.error('Error fetching device support entries', { error: (error as Error).message })
    return { status: 500, body: { ok: false, error: 'Internal server error' } }
  }
}
