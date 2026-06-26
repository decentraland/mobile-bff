import { DecentralandSignatureContext } from '@dcl/crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { isAllowedUser } from '../../../../logic/allowed-users'

export async function deleteBanHandler(
  context: HandlerContextWithPath<'bansDb' | 'logs' | 'config', '/backoffice/bans/:id'> & DecentralandSignatureContext<any>
) {
  const {
    components: { bansDb, logs, config },
    verification,
    params
  } = context

  const logger = logs.getLogger('delete-ban')
  const userAddress = verification?.auth
  const { id } = params

  if (!userAddress) {
    return {
      status: 401,
      body: { ok: false, error: 'Unauthorized' }
    }
  }

  if (!(await isAllowedUser(config, userAddress))) {
    return {
      status: 403,
      body: { ok: false, error: 'Forbidden: User not in allowed list' }
    }
  }

  try {
    const deleted = await bansDb.deleteBan(id)

    if (!deleted) {
      return {
        status: 404,
        body: { ok: false, error: 'Ban not found' }
      }
    }

    logger.info('Ban deleted', { id, deletedBy: userAddress })

    return {
      status: 200,
      body: {
        ok: true,
        data: { id }
      }
    }
  } catch (error) {
    logger.error('Error deleting ban', { error: (error as Error).message, id, deletedBy: userAddress })
    return {
      status: 500,
      body: { ok: false, error: 'Internal server error' }
    }
  }
}
