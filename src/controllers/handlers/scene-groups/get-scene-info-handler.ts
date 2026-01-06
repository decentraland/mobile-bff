import { HandlerContextWithPath } from '../../../types'

export async function getSceneInfoHandler(
  context: HandlerContextWithPath<'sceneGroupsDb' | 'bansDb' | 'logs', '/scene-info'>
) {
  const {
    components: { sceneGroupsDb, bansDb, logs },
    url
  } = context

  const logger = logs.getLogger('get-scene-info')

  try {
    const searchParams = new URL(url.toString()).searchParams
    const parcelParam = searchParams.get('parcel')

    if (!parcelParam) {
      return {
        status: 400,
        body: { ok: false, error: 'Missing parcel parameter. Use parcel=x,y' }
      }
    }

    // Parse single parcel from "x,y" format
    const parts = parcelParam.split(',')
    if (parts.length !== 2) {
      return {
        status: 400,
        body: { ok: false, error: `Invalid parcel format: "${parcelParam}". Use x,y` }
      }
    }

    const x = parseInt(parts[0], 10)
    const y = parseInt(parts[1], 10)

    if (isNaN(x) || isNaN(y)) {
      return {
        status: 400,
        body: { ok: false, error: `Invalid parcel coordinates: "${parcelParam}". Must be integers.` }
      }
    }

    const parcel = { x, y }

    // Check if parcel belongs to a scene group
    const group = await sceneGroupsDb.getSceneGroupByParcel(x, y)

    if (group) {
      // Parcel belongs to a group - check if group is banned
      const ban = await bansDb.getBanByGroupId(group.id)

      return {
        status: 200,
        body: {
          ok: true,
          data: {
            type: 'group',
            group: group,
            isBanned: ban !== null,
            sceneId: ban?.sceneId || null
          }
        }
      }
    }

    // Isolated scene - check if this parcel is banned
    const ban = await bansDb.getBanByParcel(parcel)

    return {
      status: 200,
      body: {
        ok: true,
        data: {
          type: 'scene',
          parcel: parcel,
          isBanned: ban !== null,
          sceneId: ban?.sceneId || null
        }
      }
    }
  } catch (error) {
    logger.error('Error fetching scene info', { error: (error as Error).message })
    return {
      status: 500,
      body: { ok: false, error: 'Internal server error' }
    }
  }
}
