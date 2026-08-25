import { DecentralandSignatureContext } from '@dcl/platform-crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { isAllowedUser } from '../../../../logic/allowed-users'

export async function deleteCampaignHandler(
  context: HandlerContextWithPath<'campaignsDb' | 'logs' | 'config', '/backoffice/campaigns/:token'>
    & DecentralandSignatureContext<any>
) {
  const {
    components: { campaignsDb, logs, config },
    verification,
    params
  } = context

  const logger = logs.getLogger('delete-campaign')
  const userAddress = verification?.auth
  const token = params.token

  if (!userAddress) {
    return { status: 401, body: { ok: false, error: 'Unauthorized' } }
  }

  if (!(await isAllowedUser(config, userAddress))) {
    return { status: 403, body: { ok: false, error: 'Forbidden: User not in allowed list' } }
  }

  try {
    const deleted = await campaignsDb.delete(token, userAddress)
    if (!deleted) {
      return { status: 404, body: { ok: false, error: `Campaign '${token}' not found` } }
    }

    logger.info('Campaign deleted', { token, deletedBy: userAddress })

    return { status: 200, body: { ok: true, data: { token } } }
  } catch (error) {
    logger.error('Error deleting campaign', {
      error: (error as Error).message,
      token,
      deletedBy: userAddress
    })
    return { status: 500, body: { ok: false, error: 'Internal server error' } }
  }
}
