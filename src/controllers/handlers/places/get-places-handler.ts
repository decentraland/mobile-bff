import { HandlerContextWithPath } from '../../../types'

export async function getPlacesHandler(
  context: HandlerContextWithPath<'sceneGroupsDb' | 'bansDb' | 'logs', '/places'>
) {
  const {
    components: { sceneGroupsDb, bansDb, logs },
    url
  } = context

  const logger = logs.getLogger('get-places')

  try {
    const searchParams = new URL(url.toString()).searchParams

    // Check if parameters exist (even if empty) vs have values
    const hasWorld = searchParams.has('world')
    const hasTag = searchParams.has('tag')
    const hasParcel = searchParams.has('parcel')

    const worldParam = searchParams.get('world')
    const tagParam = searchParams.get('tag')
    const parcelParam = searchParams.get('parcel')

    // If no query parameters provided, return all places
    if (!hasWorld && !hasTag && !hasParcel) {
      const groups = await sceneGroupsDb.getAllSceneGroups()

      const results = await Promise.all(
        groups.map(async (group) => {
          const ban = await bansDb.getBanByGroupId(group.id)
          return {
            type: group.worldName ? 'world' : 'group',
            group,
            isBanned: ban !== null,
            banSceneId: ban?.sceneId || null
          }
        })
      )

      return {
        status: 200,
        body: {
          ok: true,
          data: results
        }
      }
    }

    // Handle world query: GET /places?world=boedo
    if (hasWorld) {
      if (!worldParam) {
        return {
          status: 400,
          body: { ok: false, error: 'Invalid world parameter: empty value' }
        }
      }
      const group = await sceneGroupsDb.getSceneGroupByWorldName(worldParam)

      if (!group) {
        return {
          status: 200,
          body: {
            ok: true,
            data: null
          }
        }
      }

      const ban = await bansDb.getBanByGroupId(group.id)

      return {
        status: 200,
        body: {
          ok: true,
          data: {
            type: 'world',
            group,
            isBanned: ban !== null,
            banSceneId: ban?.sceneId || null
          }
        }
      }
    }

    // Handle tag query: GET /places?tag=featured,ios
    if (hasTag) {
      const tagFilters = (tagParam || '').split(',').map(t => t.trim()).filter(Boolean)

      if (tagFilters.length === 0) {
        return {
          status: 400,
          body: { ok: false, error: 'Invalid tag parameter: empty value' }
        }
      }

      const groups = await sceneGroupsDb.getAllSceneGroups(tagFilters)

      // Get ban status for each group
      const results = await Promise.all(
        groups.map(async (group) => {
          const ban = await bansDb.getBanByGroupId(group.id)
          return {
            type: group.worldName ? 'world' : 'group',
            group,
            isBanned: ban !== null,
            banSceneId: ban?.sceneId || null
          }
        })
      )

      return {
        status: 200,
        body: {
          ok: true,
          data: results
        }
      }
    }

    // Handle parcel query: GET /places?parcel=1,4
    if (hasParcel) {
      if (!parcelParam) {
        return {
          status: 400,
          body: { ok: false, error: 'Invalid parcel parameter: empty value' }
        }
      }
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
              group,
              isBanned: ban !== null,
              banSceneId: ban?.sceneId || null
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
            parcel,
            parcels: ban?.parcels || [parcel],
            isBanned: ban !== null,
            banSceneId: ban?.sceneId || null
          }
        }
      }
    }

    // Should not reach here
    return {
      status: 400,
      body: { ok: false, error: 'Invalid request' }
    }
  } catch (error) {
    logger.error('Error fetching places', { error: (error as Error).message })
    return {
      status: 500,
      body: { ok: false, error: 'Internal server error' }
    }
  }
}
