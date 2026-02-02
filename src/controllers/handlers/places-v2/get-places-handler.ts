import { HandlerContextWithPath } from '../../../types'
import { Place } from '../../../adapters/places-db'

// Flattened place response with ban status
type PlaceResponse = Place & {
  isBanned: boolean
  banSceneId: string | null
}

async function addBanStatus(
  place: Place,
  bansDb: { getBanByPlaceId: (id: string) => Promise<{ sceneId: string | null } | null> }
): Promise<PlaceResponse> {
  const ban = await bansDb.getBanByPlaceId(place.id)
  return {
    ...place,
    isBanned: ban !== null,
    banSceneId: ban?.sceneId || null
  }
}

export async function getPlacesHandler(
  context: HandlerContextWithPath<'placesDb' | 'bansDb' | 'logs', '/places'>
) {
  const {
    components: { placesDb, bansDb, logs },
    url
  } = context

  const logger = logs.getLogger('get-places')

  try {
    const searchParams = new URL(url.toString()).searchParams

    const hasWorld = searchParams.has('world')
    const hasTag = searchParams.has('tag')
    const hasParcel = searchParams.has('parcel')

    const worldParam = searchParams.get('world')
    const tagParam = searchParams.get('tag')
    const parcelParam = searchParams.get('parcel')

    // If no query parameters provided, return all places
    if (!hasWorld && !hasTag && !hasParcel) {
      const places = await placesDb.getAllPlaces()
      const results = await Promise.all(places.map(p => addBanStatus(p, bansDb)))

      return {
        status: 200,
        body: {
          ok: true,
          data: results
        }
      }
    }

    // Handle world query: GET /places?world=boedo.dcl.eth
    if (hasWorld) {
      if (!worldParam) {
        return {
          status: 400,
          body: { ok: false, error: 'Invalid world parameter: empty value' }
        }
      }
      const place = await placesDb.getPlaceByWorldName(worldParam)

      if (!place) {
        return {
          status: 200,
          body: { ok: true, data: null }
        }
      }

      return {
        status: 200,
        body: {
          ok: true,
          data: await addBanStatus(place, bansDb)
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

      const places = await placesDb.getAllPlaces(tagFilters)
      const results = await Promise.all(places.map(p => addBanStatus(p, bansDb)))

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

      const position = `${x},${y}`

      // First try to find by base position
      let place = await placesDb.getPlaceByBasePosition(position)

      // If not found, try by any position (place_positions)
      if (!place) {
        place = await placesDb.getPlaceByPosition(position)
      }

      if (place) {
        return {
          status: 200,
          body: {
            ok: true,
            data: await addBanStatus(place, bansDb)
          }
        }
      }

      return {
        status: 200,
        body: { ok: true, data: null }
      }
    }

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
