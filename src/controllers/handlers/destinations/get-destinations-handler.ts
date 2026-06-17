import { HandlerContextWithPath } from '../../../types'
import { Destination, DestinationsResponse } from '../../../adapters/destinations-api'

// TEMP workaround (decentraland/godot-explorer#1827):
// places.org `/destinations?order_by=most_active` does NOT sort by connected
// users. Upstream silently drops `most_active` from its ORDER BY whitelist and
// only adds a binary `is_most_active_place` flag behind `highlighted`/`ranking`,
// so highlighted/empty scenes rank above scenes that actually have people online.
// The `getForPlaces` (tagged/iOS) path also returns results in accumulation
// order, discarding any upstream ordering entirely.
//
// Until the upstream `/destinations` ordering is fixed (mirror the working
// `/api/places?order_by=most_active` -> getPlaceMostActiveList), we re-rank here:
// pull the full candidate window, sort by user_count desc, drop empty scenes,
// then slice to the client's requested page.
const MOST_ACTIVE = 'most_active'
const MOST_ACTIVE_FETCH_LIMIT = 100

function rankByConnectedUsers(response: DestinationsResponse, offset: number, limit: number): DestinationsResponse {
  const ranked = response.data
    .filter((d: Destination) => Number(d.user_count ?? 0) > 0)
    .sort((a: Destination, b: Destination) => Number(b.user_count ?? 0) - Number(a.user_count ?? 0))

  return {
    ok: true,
    data: ranked.slice(offset, offset + limit),
    total: ranked.length
  }
}

function sortByConnectedUsers(response: DestinationsResponse, offset: number, limit: number): DestinationsResponse {
  // Like rankByConnectedUsers but WITHOUT filtering out 0-user destinations
  // (used for search queries where we want all matching results)
  const sorted = response.data
    .sort((a: Destination, b: Destination) => Number(b.user_count ?? 0) - Number(a.user_count ?? 0))

  return {
    ok: true,
    data: sorted.slice(offset, offset + limit),
    total: sorted.length
  }
}

export async function getDestinationsHandler(
  context: HandlerContextWithPath<'placesDb' | 'destinationsApi' | 'logs', '/destinations'>
) {
  const {
    components: { placesDb, destinationsApi, logs },
    url,
    request
  } = context
  const logger = logs.getLogger('get-destinations')

  // Extract signed fetch headers to forward to upstream API
  const headersToForward: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    if (key.toLowerCase().startsWith('x-identity-')) {
      headersToForward[key.toLowerCase()] = value
    }
  })

  try {
    const searchParams = new URL(url.toString()).searchParams
    const tagParam = searchParams.get('tag')
    const searchQuery = searchParams.get('search')

    // TEMP (#1827): for most_active we re-rank the whole candidate set by
    // user_count, so fetch the full window upstream and slice locally.
    // EXCEPTION: when search is present, skip the most_active filtering
    // (foundation returns 0 results for search+most_active due to hardcoded
    // filter, so we need to fetch without order_by and sort in-memory instead)
    const orderBy = searchParams.get('order_by')
    const isMostActive = orderBy === MOST_ACTIVE && !searchQuery
    const clientOffset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0)
    const clientLimit = parseInt(searchParams.get('limit') || '100', 10) || 100
    if (isMostActive) {
      searchParams.set('offset', '0')
      searchParams.set('limit', String(MOST_ACTIVE_FETCH_LIMIT))
    } else if (orderBy === MOST_ACTIVE && searchQuery) {
      // When search is present with most_active, remove order_by from upstream
      // request (to get all results) and we'll sort by user_count in-memory
      searchParams.delete('order_by')
    }

    let response: DestinationsResponse

    if (tagParam) {
      const tags = tagParam
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
      if (tags.length === 0) {
        return { status: 400, body: { ok: false, error: 'Invalid tag parameter' } }
      }

      const places = await placesDb.getAllPlaces(tags)

      // Remove 'tag' from params, pass the rest to API
      searchParams.delete('tag')
      response = await destinationsApi.getForPlaces(places, searchParams.toString(), headersToForward)
    } else {
      searchParams.delete('tag')
      response = await destinationsApi.proxyQuery(searchParams.toString(), headersToForward)
    }

    if (isMostActive) {
      response = rankByConnectedUsers(response, clientOffset, clientLimit)
    } else if (orderBy === MOST_ACTIVE && searchQuery) {
      // For search+most_active: sort by user_count but don't filter out 0-user results
      response = sortByConnectedUsers(response, clientOffset, clientLimit)
    }

    return { status: 200, body: response }
  } catch (error) {
    logger.error('Error', { error: (error as Error).message })
    return { status: 500, body: { ok: false, error: 'Internal server error' } }
  }
}
