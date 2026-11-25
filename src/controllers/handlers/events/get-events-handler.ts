import { HandlerContextWithPath } from '../../../types'
import { Place } from '../../../adapters/places-db'
import { ICacheComponent } from '../../../adapters/cache'
import { IFetchComponent, ILoggerComponent } from '@well-known-components/interfaces'
import { IPlacesDbComponent } from '../../../adapters/places-db'
import { ALLOWED_IOS_TAG, coversEvent, isEventBlocked, PlaceSet } from '../../../logic/content-policy'

export type Event = {
  id: string
  name: string
  world?: boolean
  server?: string
  position?: number[]
  [key: string]: unknown
}

export type EventsResponse = {
  ok: boolean
  data: Event[]
  total: number
}

function eventIdCacheKey(id: string): string {
  return `events:id:${id}`
}

type FetchComponents = {
  fetch: IFetchComponent
  cache: ICacheComponent
  logs: ILoggerComponent
}

function eventMatchesPlaces(event: Event, positionSet: Set<string>, worldSet: Set<string>): boolean {
  if (event.world) {
    return !!event.server && worldSet.has(event.server.toLowerCase())
  }

  if (event.position && event.position.length === 2) {
    const key = `${event.position[0]},${event.position[1]}`
    return positionSet.has(key)
  }

  return false
}

// `list` (live / upcoming) is what the 2.x client asks for; `limit` is never forwarded, the
// place filters run on the whole list.
function upstreamParams(search: string | undefined, list: string | undefined): URLSearchParams {
  const params = new URLSearchParams()
  if (search) {
    params.set('search', search)
  }
  if (list) {
    params.set('list', list)
  }
  return params
}

async function fetchEventsForPlaces(
  places: Place[],
  search: string | undefined,
  list: string | undefined,
  apiUrl: string,
  ttl: number,
  components: FetchComponents
): Promise<EventsResponse> {
  const { fetch, cache, logs } = components
  const logger = logs.getLogger('get-events')
  const startTotal = Date.now()

  if (places.length === 0) {
    return { ok: true, data: [], total: 0 }
  }

  // Build lookup sets for matching events against places
  const positionSet = new Set<string>()
  const worldSet = new Set<string>()
  for (const place of places) {
    if (place.type === 'scene') {
      for (const pos of place.positions) {
        positionSet.add(pos)
      }
    } else if (place.type === 'world' && place.worldName) {
      worldSet.add(place.worldName.toLowerCase())
    }
  }

  const positionsSorted = Array.from(positionSet).sort()
  const worldsSorted = Array.from(worldSet).sort()

  // Create cache key from all positions + worlds + search
  const cacheKey = `events:query:places:${positionsSorted.join(',')}:${worldsSorted.join(',')}:${search || ''}:${list || ''}`

  // Check cache first
  const startCacheRead = Date.now()
  const cachedKeys = await cache.get<string[]>(cacheKey)
  if (cachedKeys) {
    const events = await Promise.all(
      cachedKeys.map(key => cache.get<Event>(key))
    )
    const valid = events.filter((e): e is Event => e !== null)

    if (valid.length === cachedKeys.length) {
      const cacheReadMs = Date.now() - startCacheRead
      const totalMs = Date.now() - startTotal
      logger.info('fetchEventsForPlaces (cache hit)', {
        positions: positionSet.size,
        worlds: worldSet.size,
        results: valid.length,
        cacheReadMs,
        totalMs
      })
      return { ok: true, data: valid, total: valid.length }
    }
  }
  const cacheReadMs = Date.now() - startCacheRead

  try {
    // Fetch all events, then filter client-side by place membership
    const params = upstreamParams(search, list)
    const url = params.toString() ? `${apiUrl}?${params}` : apiUrl

    const startFetch = Date.now()
    const response = await fetch.fetch(url)
    const fetchMs = Date.now() - startFetch

    if (!response.ok) {
      logger.warn('Events API error', { status: response.status })
      return { ok: false, data: [], total: 0 }
    }

    const data = await response.json() as EventsResponse
    const allEvents = data.data ?? []

    // Filter to events that match any of our places
    const filtered = allEvents.filter(e => eventMatchesPlaces(e, positionSet, worldSet))

    // Cache results
    const startCacheWrite = Date.now()
    const keys = await Promise.all(filtered.map(async event => {
      const key = eventIdCacheKey(event.id)
      await cache.set(key, event, ttl)
      return key
    }))
    await cache.set(cacheKey, keys, ttl)
    const cacheWriteMs = Date.now() - startCacheWrite

    const totalMs = Date.now() - startTotal
    logger.info('fetchEventsForPlaces (fetched)', {
      positions: positionSet.size,
      worlds: worldSet.size,
      totalEvents: allEvents.length,
      filteredEvents: filtered.length,
      cacheReadMs,
      fetchMs,
      cacheWriteMs,
      totalMs
    })

    return { ok: true, data: filtered, total: filtered.length }
  } catch (error) {
    logger.error('Fetch error', { error: (error as Error).message })
    return { ok: false, data: [], total: 0 }
  }
}

async function proxyEvents(
  search: string | undefined,
  list: string | undefined,
  apiUrl: string,
  ttl: number,
  components: FetchComponents
): Promise<EventsResponse> {
  const { fetch, cache, logs } = components
  const logger = logs.getLogger('get-events')
  const startTotal = Date.now()

  const queryString = upstreamParams(search, list).toString()
  const queryKey = `events:query:${queryString}`

  const startCacheRead = Date.now()
  const cachedKeys = await cache.get<string[]>(queryKey)
  if (cachedKeys) {
    const events = await Promise.all(
      cachedKeys.map(key => cache.get<Event>(key))
    )
    const valid = events.filter((e): e is Event => e !== null)

    if (valid.length === cachedKeys.length) {
      const cacheReadMs = Date.now() - startCacheRead
      logger.info('proxyEvents cache hit', { results: valid.length, cacheReadMs })
      return { ok: true, data: valid, total: valid.length }
    }
  }
  const cacheReadMs = Date.now() - startCacheRead

  try {
    const url = queryString ? `${apiUrl}?${queryString}` : apiUrl

    const startFetch = Date.now()
    const response = await fetch.fetch(url)
    const fetchMs = Date.now() - startFetch

    const startParse = Date.now()
    const data = await response.json() as EventsResponse
    const parseMs = Date.now() - startParse

    const startCacheWrite = Date.now()
    const keys = await Promise.all(data.data.map(async event => {
      const key = eventIdCacheKey(event.id)
      await cache.set(key, event, ttl)
      return key
    }))
    await cache.set(queryKey, keys, ttl)
    const cacheWriteMs = Date.now() - startCacheWrite

    const totalMs = Date.now() - startTotal
    logger.info('proxyEvents', {
      results: data.data.length,
      cacheReadMs,
      fetchMs,
      parseMs,
      cacheWriteMs,
      totalMs
    })

    return data
  } catch (error) {
    logger.error('Proxy error', { error: (error as Error).message })
    return { ok: false, data: [], total: 0 }
  }
}

function withoutBanned(response: EventsResponse, banned: PlaceSet | null): EventsResponse {
  if (!banned) {
    return response
  }
  const data = response.data.filter(event => !coversEvent(banned, event))
  return { ...response, data, total: data.length }
}

export async function getEventsHandler(
  context: HandlerContextWithPath<'placesDb' | 'fetch' | 'cache' | 'config' | 'contentPolicy' | 'logs', '/events'>
) {
  const { components: { placesDb, fetch, cache, config, contentPolicy, logs }, url } = context
  const logger = logs.getLogger('get-events')

  try {
    const searchParams = new URL(url.toString()).searchParams
    const tagParam = searchParams.get('tag')
    const search = searchParams.get('search') || undefined
    const list = searchParams.get('list') || undefined

    // Config
    const apiUrl = await config.getString('EVENTS_API_URL') ?? 'https://events.decentraland.org/api/events'
    const ttl = parseInt(await config.getString('EVENTS_CACHE_TTL_MS') ?? '7200000')

    const fetchComponents = { fetch, cache, logs }

    // Every `tag` param: clients send the curated tag and `allowed_ios` as two of them
    const requestedTags = searchParams.getAll('tag').flatMap(t => t.split(',')).map(t => t.trim())
    const banned = await contentPolicy.getBannedPlaces()
    if (requestedTags.includes(ALLOWED_IOS_TAG) && await contentPolicy.isBlockListEnabled()) {
      const curatedTags = requestedTags.filter(t => t && t !== ALLOWED_IOS_TAG)
      const [index, all] = await Promise.all([
        contentPolicy.getBlockIndex(),
        curatedTags.length > 0
          ? placesDb.getAllPlaces(curatedTags).then(places =>
              fetchEventsForPlaces(places, search, list, apiUrl, ttl, fetchComponents))
          : proxyEvents(search, list, apiUrl, ttl, fetchComponents)
      ])
      const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0)
      const limit = parseInt(searchParams.get('limit') || '', 10) || undefined
      const kept = withoutBanned(all, banned).data.filter(event => !isEventBlocked(event, index))
      const data = kept.slice(offset, limit === undefined ? undefined : offset + limit)

      return { status: 200, body: { ok: all.ok, data, total: data.length } }
    }

    if (tagParam) {
      const tags = tagParam.split(',').map(t => t.trim()).filter(Boolean)
      if (tags.length === 0) {
        return { status: 400, body: { ok: false, error: 'Invalid tag parameter' } }
      }

      const places = await placesDb.getAllPlaces(tags)
      const response = await fetchEventsForPlaces(places, search, list, apiUrl, ttl, fetchComponents)

      return { status: 200, body: withoutBanned(response, banned) }
    }

    // Proxy mode: direct fetch with optional search
    const response = await proxyEvents(search, list, apiUrl, ttl, fetchComponents)
    return { status: 200, body: withoutBanned(response, banned) }

  } catch (error) {
    logger.error('Error', { error: (error as Error).message })
    return { status: 500, body: { ok: false, error: 'Internal server error' } }
  }
}
