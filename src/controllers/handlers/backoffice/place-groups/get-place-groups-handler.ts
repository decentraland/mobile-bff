import { DecentralandSignatureContext } from '@dcl/crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { isAllowedUser } from '../../../../logic/allowed-users'

export async function getBackofficePlaceGroupsHandler(
  context: HandlerContextWithPath<'placeGroupsDb' | 'logs' | 'config', '/backoffice/place-groups'> & DecentralandSignatureContext<any>
) {
  const {
    components: { placeGroupsDb, logs, config },
    verification
  } = context

  const logger = logs.getLogger('get-backoffice-place-groups')
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
    const groups = await placeGroupsDb.getAllPlaceGroups()

    return {
      status: 200,
      body: {
        ok: true,
        data: groups
      }
    }
  } catch (error) {
    logger.error('Error fetching place groups', { error: (error as Error).message })
    return {
      status: 500,
      body: { ok: false, error: 'Internal server error' }
    }
  }
}
