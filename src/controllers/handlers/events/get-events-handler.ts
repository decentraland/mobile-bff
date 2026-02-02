import { HandlerContextWithPath } from '../../../types'
import { Place } from '../../../adapters/places-db'
import { ICacheComponent } from '../../../adapters/cache'
import { IFetchComponent, IConfigComponent, ILoggerComponent } from '@well-known-components/interfaces'
import { IPlacesDbComponent } from '../../../adapters/places-db'

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

function deduplicateEvents(events: Event[]): Event[] {
  const seen = new Map<string, Event>()
  for (const event of events) {
    if (!seen.has(event.id)) {
      seen.set(event.id, event)
    }
  }
  return Array.from(seen.values())
}

type FetchComponents = {
  fetch: IFetchComponent
  cache: ICacheComponent
  logs: ILoggerComponent
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

  const positions = places
    .filter(p => p.type === 'scene' && p.basePosition)
    .map(p => p.basePosition!)
    .sort()

  const worlds = places
    .filter(p => p.type === 'world' && p.worldName)
    .map(p => p.worldName!)
    .sort()

  // Create cache key from positions + worlds + search
  const cacheKey = `events:query:places:${positions.join(',')}:${worlds.join(',')}:${search || ''}`

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
        positions: positions.length,
        worlds: worlds.length,
        results: valid.length,
        cacheReadMs,
        totalMs
      })
      return { ok: true, data: valid, total: valid.length }
    }
  }
  const cacheReadMs = Date.now() - startCacheRead

  const allEvents: Event[] = []
  let positionsMs = 0
  let worldsMs = 0

  try {
    // Build fetch promises for parallel execution
    const positionsPromise = positions.length > 0
      ? (async () => {
          const params = new URLSearchParams()
          for (const pos of positions) {
            params.append('positions[]', pos)
          }
          if (search) {
            params.set('search', search)
          }

          const start = Date.now()
          const response = await fetch.fetch(`${apiUrl}?${params}`)
          const ms = Date.now() - start
          return { response, ms }
        })()
      : null

    const worldsPromise = worlds.length > 0
      ? (async () => {
          const params = new URLSearchParams()
          for (const world of worlds) {
            params.append('world_names[]', world)
          }
          if (search) {
            params.set('search', search)
          }

          const start = Date.now()
          const response = await fetch.fetch(`${apiUrl}?${params}`)
          const ms = Date.now() - start
          return { response, ms }
        })()
      : null

    // Execute both fetches in parallel
    const [positionsResult, worldsResult] = await Promise.all([positionsPromise, worldsPromise])

    // Process positions result
    if (positionsResult) {
      positionsMs = positionsResult.ms
      if (positionsResult.response.ok) {
        const positionsData = await positionsResult.response.json() as EventsResponse
        if (positionsData.data) {
          allEvents.push(...positionsData.data)
        }
      } else {
        logger.warn('Positions API error', { status: positionsResult.response.status })
      }
    }

    // Process worlds result
    if (worldsResult) {
      worldsMs = worldsResult.ms
      if (worldsResult.response.ok) {
        const worldsData = await worldsResult.response.json() as EventsResponse
        if (worldsData.data) {
          allEvents.push(...worldsData.data)
        }
      } else {
        logger.warn('Worlds API error', { status: worldsResult.response.status })
      }
    }

    // Deduplicate by ID
    const dedupedEvents = deduplicateEvents(allEvents)

    // Cache results by ID, then store the list of IDs for this query
    const startCacheWrite = Date.now()
    const keys = await Promise.all(dedupedEvents.map(async event => {
      const key = eventIdCacheKey(event.id)
      await cache.set(key, event, ttl)
      return key
    }))
    await cache.set(cacheKey, keys, ttl)
    const cacheWriteMs = Date.now() - startCacheWrite

    const totalMs = Date.now() - startTotal
    logger.info('fetchEventsForPlaces (fetched)', {
      positions: positions.length,
      worlds: worlds.length,
      results: dedupedEvents.length,
      cacheReadMs,
      positionsMs,
      worldsMs,
      cacheWriteMs,
      totalMs
    })

    return { ok: true, data: dedupedEvents, total: dedupedEvents.length }
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
