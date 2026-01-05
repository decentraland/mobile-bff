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
    const parcelsParam = searchParams.get('parcels')

    if (!parcelsParam) {
      return {
        status: 400,
        body: { ok: false, error: 'Missing parcels parameter. Use parcels=x1,y1;x2,y2' }
      }
    }

    // Parse parcels from "x1,y1;x2,y2;x3,y3" format
    const parcels: { x: number; y: number }[] = []
    const parcelStrings = parcelsParam.split(';')

    for (const parcelStr of parcelStrings) {
      const parts = parcelStr.split(',')
      if (parts.length !== 2) {
        return {
          status: 400,
          body: { ok: false, error: `Invalid parcel format: "${parcelStr}". Use x,y` }
        }
      }

      const x = parseInt(parts[0], 10)
      const y = parseInt(parts[1], 10)

      if (isNaN(x) || isNaN(y)) {
        return {
          status: 400,
          body: { ok: false, error: `Invalid parcel coordinates: "${parcelStr}". Must be integers.` }
        }
      }

      parcels.push({ x, y })
    }

    if (parcels.length === 0) {
      return {
        status: 400,
        body: { ok: false, error: 'At least one parcel is required' }
      }
    }

    // Check if any parcel belongs to a scene group (use first parcel to find group)
    const group = await sceneGroupsDb.getSceneGroupByParcel(parcels[0].x, parcels[0].y)

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
            isBanned: ban !== null
          }
        }
      }
    }

    // Isolated scene - check if these exact parcels are banned
    const ban = await bansDb.getBanByParcels(parcels)

    return {
      status: 200,
      body: {
        ok: true,
        data: {
          type: 'scene',
          parcels: parcels,
          isBanned: ban !== null
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
