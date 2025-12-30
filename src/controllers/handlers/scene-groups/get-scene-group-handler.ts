import { HandlerContextWithPath } from '../../../types'

export async function getSceneGroupHandler(
  context: HandlerContextWithPath<'sceneGroupsDb' | 'logs', '/scene-groups/:id'>
) {
  const {
    components: { sceneGroupsDb, logs },
    params
  } = context

  const logger = logs.getLogger('get-scene-group')
  const { id } = params

  try {
    const group = await sceneGroupsDb.getSceneGroupById(id)

    if (!group) {
      return {
        status: 404,
        body: { ok: false, error: 'Scene group not found' }
      }
    }

    return {
      status: 200,
      body: {
        ok: true,
        data: group
      }
    }
  } catch (error) {
    logger.error('Error fetching scene group', { error: (error as Error).message, id })
    return {
      status: 500,
      body: { ok: false, error: 'Internal server error' }
    }
  }
}
