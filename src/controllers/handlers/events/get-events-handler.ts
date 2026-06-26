import { HandlerContextWithPath } from '../../../types'
import { Place } from '../../../adapters/places-db'
import { ICacheComponent } from '../../../adapters/cache'
import { ILoggerComponent } from '@well-known-components/interfaces'
import { IFetchComponent } from '@dcl/core-commons'
import { IPlacesDbComponent } from '../../../adapters/places-db'
import { drainResponse } from '../../../logic/fetch-utils'

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

async function fetchEventsForPlaces(
  places: Place[],
  search: string | undefined,
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
  const cacheKey = `events:query:places:${positionsSorted.join(',')}:${worldsSorted.join(',')}:${search || ''}`

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
    const params = new URLSearchParams()
    if (search) {
      params.set('search', search)
    }
    const url = params.toString() ? `${apiUrl}?${params}` : apiUrl

    const startFetch = Date.now()
    const response = await fetch.fetch(url)
    const fetchMs = Date.now() - startFetch

    if (!response.ok) {
      logger.warn('Events API error', { status: response.status })
      await drainResponse(response)
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
  apiUrl: string,
  ttl: number,
  components: FetchComponents
): Promise<EventsResponse> {
  const { fetch, cache, logs } = components
  const logger = logs.getLogger('get-events')
  const startTotal = Date.now()

  const params = new URLSearchParams()
  if (search) {
    params.set('search', search)
  }
  const queryString = params.toString()
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

export async function getEventsHandler(
  context: HandlerContextWithPath<'placesDb' | 'fetch' | 'cache' | 'config' | 'logs', '/events'>
) {
  const { components: { placesDb, fetch, cache, config, logs }, url } = context
  const logger = logs.getLogger('get-events')

  try {
    const searchParams = new URL(url.toString()).searchParams
    const tagParam = searchParams.get('tag')
    const search = searchParams.get('search') || undefined

    // Config
    const apiUrl = await config.getString('EVENTS_API_URL') ?? 'https://events.decentraland.org/api/events'
    const ttl = parseInt(await config.getString('EVENTS_CACHE_TTL_MS') ?? '7200000')

    const fetchComponents = { fetch, cache, logs }

    if (tagParam) {
      const tags = tagParam.split(',').map(t => t.trim()).filter(Boolean)
      if (tags.length === 0) {
        return { status: 400, body: { ok: false, error: 'Invalid tag parameter' } }
      }

      const places = await placesDb.getAllPlaces(tags)
      const response = await fetchEventsForPlaces(places, search, apiUrl, ttl, fetchComponents)

      return { status: 200, body: response }
    }

    // Proxy mode: direct fetch with optional search
    const response = await proxyEvents(search, apiUrl, ttl, fetchComponents)
    return { status: 200, body: response }

  } catch (error) {
    logger.error('Error', { error: (error as Error).message })
    return { status: 500, body: { ok: false, error: 'Internal server error' } }
  }
}
