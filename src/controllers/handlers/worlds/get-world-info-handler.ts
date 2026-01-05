import { HandlerContextWithPath } from '../../../types'

// Response from /entities/active endpoint
interface WorldEntity {
  id: string
  timestamp: number
  type: string
  pointers: string[]
  content: Array<{ file: string; hash: string }>
  metadata?: {
    display?: {
      title?: string
      description?: string
      navmapThumbnail?: string
      favicon?: string
    }
    owner?: string
    tags?: string[]
    worldConfiguration?: {
      name?: string
    }
  }
}

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
    // Fetch world entity info using the /entities/active endpoint
    const entitiesUrl = `https://worlds-content-server.decentraland.org/entities/active`
    const entitiesResponse = await fetch.fetch(entitiesUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pointers: [normalizedWorldName] })
    })

    if (!entitiesResponse.ok) {
      throw new Error(`Failed to fetch world entities: ${entitiesResponse.status}`)
    }

    const entities = await entitiesResponse.json() as WorldEntity[]

    if (!entities || entities.length === 0) {
      return {
        status: 404,
        body: { ok: false, error: 'World not found' }
      }
    }

    const entity = entities[0]
    const metadata = entity.metadata

    // Build thumbnail URL if available
    let thumbnail: string | null = null
    if (metadata?.display?.navmapThumbnail) {
      // Find the hash for the thumbnail file
      const thumbnailContent = entity.content.find(c => c.file === metadata.display?.navmapThumbnail)
      if (thumbnailContent) {
        thumbnail = `https://worlds-content-server.decentraland.org/contents/${thumbnailContent.hash}`
      }
    }

    // Check if this world is banned
    const ban = await bansDb.getBanByWorldName(normalizedWorldName)

    // Extract relevant info for the response
    const worldInfo = {
      name: normalizedWorldName,
      title: metadata?.display?.title || normalizedWorldName,
      description: metadata?.display?.description || null,
      thumbnail,
      owner: metadata?.owner || null,
      tags: metadata?.tags || [],
      sceneId: entity.id,  // Entity ID (for detecting redeploys)
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
