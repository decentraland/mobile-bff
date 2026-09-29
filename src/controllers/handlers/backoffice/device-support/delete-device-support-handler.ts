import { DecentralandSignatureContext } from '@dcl/crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { isAllowedUser } from '../../../../logic/allowed-users'

export async function deleteDeviceSupportHandler(
  context: HandlerContextWithPath<'deviceSupportDb' | 'logs' | 'config', '/backoffice/device-support/:soc'>
    & DecentralandSignatureContext<any>
) {
  const {
    components: { deviceSupportDb, logs, config },
    verification,
    params
  } = context

  const logger = logs.getLogger('delete-device-support')
  const userAddress = verification?.auth
  const soc = params.soc

  if (!userAddress) {
    return { status: 401, body: { ok: false, error: 'Unauthorized' } }
  }

  if (!(await isAllowedUser(config, userAddress))) {
    return { status: 403, body: { ok: false, error: 'Forbidden: User not in allowed list' } }
  }

  try {
    const deleted = await deviceSupportDb.delete(soc)
    if (!deleted) {
      return { status: 404, body: { ok: false, error: `No device-support entry for '${soc}'` } }
    }

    logger.info('Device support entry deleted', { soc, deletedBy: userAddress })

    return { status: 200, body: { ok: true, data: { soc } } }
  } catch (error) {
    logger.error('Error deleting device support entry', {
      error: (error as Error).message,
      soc,
      deletedBy: userAddress
    })
    return { status: 500, body: { ok: false, error: 'Internal server error' } }
  }
}
