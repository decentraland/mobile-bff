import { HandlerContextWithPath } from '../../../types'

export async function getWorldInfoHandler(
  context: HandlerContextWithPath<'fetch' | 'bansDb' | 'logs', '/worlds/:worldName'>
) {
  const {
    components: { fetch, bansDb, logs },
    params
  } = context

  const logger = logs.getLogger('get-world-info')
  const { worldName } = params

  if (!worldName || worldName.trim() === '') {
    return {
      status: 400,
      body: { ok: false, error: 'World name is required' }
    }
  }

  let normalizedWorldName = worldName.trim().toLowerCase()

  // Append .dcl.eth if not already present
  if (!normalizedWorldName.endsWith('.dcl.eth') && !normalizedWorldName.endsWith('.eth')) {
    normalizedWorldName = `${normalizedWorldName}.dcl.eth`
  }

  try {
    // Check if this world is banned
    const ban = await bansDb.getBanByWorldName(normalizedWorldName)

    // Extract relevant info for the response
    const worldInfo = {
      name: normalizedWorldName,
      isBanned: ban !== null,
      banId: ban?.id || null,
      banReason: ban?.reason || null,
      banSceneId: ban?.sceneId || null  // Scene ID at ban time (for detecting redeploys)
    }

    return {
      status: 200,
      body: {
        ok: true,
        data: worldInfo
      }
    }
  } catch (error) {
    logger.error('Error fetching world info', { error: (error as Error).message, worldName: normalizedWorldName })
    return {
      status: 500,
      body: { ok: false, error: 'Failed to fetch world info' }
    }
  }
}
