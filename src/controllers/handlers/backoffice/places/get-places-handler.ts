import { DecentralandSignatureContext } from '@dcl/platform-crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { isAllowedUser } from '../../../../logic/allowed-users'

export async function getBackofficePlacesHandler(
  context: HandlerContextWithPath<'placesDb' | 'logs' | 'config', '/backoffice/places'> & DecentralandSignatureContext<any>
) {
  const {
    components: { placesDb, logs, config },
    verification
  } = context

  const logger = logs.getLogger('get-backoffice-places')
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
    const places = await placesDb.getAllPlaces()

    return {
      status: 200,
      body: {
        ok: true,
        data: places
      }
    }
  } catch (error) {
    logger.error('Error fetching places', { error: (error as Error).message })
    return {
      status: 500,
      body: { ok: false, error: 'Internal server error' }
    }
  }
}
