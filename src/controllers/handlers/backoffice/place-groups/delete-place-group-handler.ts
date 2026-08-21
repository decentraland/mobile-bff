import { DecentralandSignatureContext } from '@dcl/crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { isAllowedUser } from '../../../../logic/allowed-users'

export async function deletePlaceGroupHandler(
  context: HandlerContextWithPath<'placeGroupsDb' | 'logs' | 'config', '/backoffice/place-groups/:id'> & DecentralandSignatureContext<any>
) {
  const {
    components: { placeGroupsDb, logs, config },
    verification,
    params
  } = context

  const logger = logs.getLogger('delete-place-group')
  const userAddress = verification?.auth

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
    const { id } = params
    const deleted = await placeGroupsDb.deletePlaceGroup(id)

    if (!deleted) {
      return {
        status: 404,
        body: { ok: false, error: 'Place group not found' }
      }
    }

    logger.info('Place group deleted', { id, deletedBy: userAddress })

    return {
      status: 200,
      body: {
        ok: true,
        data: { id }
      }
    }
  } catch (error) {
    logger.error('Error deleting place group', { error: (error as Error).message, deletedBy: userAddress })
    return {
      status: 500,
      body: { ok: false, error: 'Internal server error' }
    }
  }
}
