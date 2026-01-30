import { HandlerContextWithPath } from '../../../types'

export async function getSceneGroupsHandler(
  context: HandlerContextWithPath<'sceneGroupsDb' | 'logs', '/scene-groups'>
) {
  const {
    components: { sceneGroupsDb, logs },
    url
  } = context

  const logger = logs.getLogger('get-scene-groups')

  try {
    // Support ?tag=... query parameter for filtering (comma-separated)
    const searchParams = new URL(url.toString()).searchParams
    const tagParam = searchParams.get('tag')
    const tagFilters = tagParam ? tagParam.split(',').map(t => t.trim()).filter(Boolean) : undefined

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
