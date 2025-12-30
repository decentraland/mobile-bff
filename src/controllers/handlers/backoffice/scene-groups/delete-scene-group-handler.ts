import { DecentralandSignatureContext } from '@dcl/platform-crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { isAllowedUser } from '../../../../logic/allowed-users'

export async function deleteSceneGroupHandler(
  context: HandlerContextWithPath<'sceneGroupsDb' | 'logs' | 'config', '/backoffice/scene-groups/:id'> & DecentralandSignatureContext<any>
) {
  const {
    components: { sceneGroupsDb, logs, config },
    verification,
    params
  } = context

  const logger = logs.getLogger('delete-scene-group')
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
    const deleted = await sceneGroupsDb.deleteSceneGroup(id)

    if (!deleted) {
      return {
        status: 404,
        body: { ok: false, error: 'Scene group not found' }
      }
    }

    logger.info('Scene group deleted', { id, deletedBy: userAddress })

    return {
      status: 200,
      body: {
        ok: true,
        data: { id }
      }
    }
  } catch (error) {
    logger.error('Error deleting scene group', { error: (error as Error).message, id, deletedBy: userAddress })
    return {
      status: 500,
      body: { ok: false, error: 'Internal server error' }
    }
  }
}
