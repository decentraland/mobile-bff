import { DecentralandSignatureContext } from '@dcl/platform-crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { isAllowedUser } from '../../../../logic/allowed-users'

export async function getBackofficeSceneGroupsHandler(
  context: HandlerContextWithPath<'sceneGroupsDb' | 'logs' | 'config', '/backoffice/scene-groups'> & DecentralandSignatureContext<any>
) {
  const {
    components: { sceneGroupsDb, logs, config },
    verification
  } = context

  const logger = logs.getLogger('get-backoffice-scene-groups')
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
    // Support ?tag=... and ?worldName=... query parameters for filtering
    const url = new URL(context.request.url, 'http://localhost')
    const tagParam = url.searchParams.get('tag')
    const tagFilters = tagParam ? tagParam.split(',').map(t => t.trim()).filter(Boolean) : undefined
    const worldNameFilter = url.searchParams.get('worldName') || undefined

    if (worldNameFilter) {
      // Return single group by world name (or null)
      const group = await sceneGroupsDb.getSceneGroupByWorldName(worldNameFilter)
      return {
        status: 200,
        body: {
          ok: true,
          data: group
        }
      }
    }

    const groups = await sceneGroupsDb.getAllSceneGroups(tagFilters)

    return {
      status: 200,
      body: {
        ok: true,
        data: groups
      }
    }
  } catch (error) {
    logger.error('Error fetching scene groups', { error: (error as Error).message })
    return {
      status: 500,
      body: { ok: false, error: 'Internal server error' }
    }
  }
}
