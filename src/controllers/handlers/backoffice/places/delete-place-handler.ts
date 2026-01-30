import { DecentralandSignatureContext } from '@dcl/platform-crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { isAllowedUser } from '../../../../logic/allowed-users'

export async function deletePlaceHandler(
  context: HandlerContextWithPath<'placesDb' | 'logs' | 'config', '/backoffice/places/:id'> & DecentralandSignatureContext<any>
) {
  const {
    components: { placesDb, logs, config },
    verification,
    params
  } = context

  const logger = logs.getLogger('delete-place')
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
    const deleted = await placesDb.deletePlace(id)

    if (!deleted) {
      return {
        status: 404,
        body: { ok: false, error: 'Place not found' }
      }
    }

    logger.info('Place deleted', { id, deletedBy: userAddress })

    return {
      status: 200,
      body: {
        ok: true,
        data: { id }
      }
    }
  } catch (error) {
    logger.error('Error deleting place', { error: (error as Error).message, deletedBy: userAddress })
    return {
      status: 500,
      body: { ok: false, error: 'Internal server error' }
    }
  }
}
