import { ILoggerComponent, IFetchComponent, IConfigComponent } from '@well-known-components/interfaces'
import { Place } from './places-db'
import { ICacheComponent } from './cache'

export type Destination = {
  id: string
  title: string
  base_position?: string
  world_name?: string
  [key: string]: unknown
}

export type DestinationsResponse = {
  ok: boolean
  data: Destination[]
  total: number
}

export interface IDestinationsApiComponent {
  getForPlaces(places: Place[], queryString?: string): Promise<DestinationsResponse>
  proxyQuery(queryString: string): Promise<DestinationsResponse>
}

type Components = {
  fetch: IFetchComponent
  config: IConfigComponent
  cache: ICacheComponent
  logs: ILoggerComponent
}

function destIdCacheKey(id: string): string {
  return `dest:id:${id}`
}

function deduplicateDestinations(destinations: Destination[]): Destination[] {
  // Deduplicate by:
  // 1. base_position (exact match, keep most recent)
  // 2. world_name (case-insensitive, keep most recent)
  // 3. ID only (for destinations without position or world)
  // The upstream API can return duplicate destinations for the same position
  // or case-variant world names.

  const byPosition = new Map<string, Destination>()
  const byWorldNormalized = new Map<string, Destination>()
  const byIdOnly: Destination[] = []

  for (const dest of destinations) {
    let handled = false

    if (dest.base_position) {
      // For scenes: keep one per base_position, prefer most recent
      const existing = byPosition.get(dest.base_position)
      if (!existing) {
        byPosition.set(dest.base_position, dest)
      } else if (dest.updated_at && existing.updated_at) {
        if (new Date(dest.updated_at as string) > new Date(existing.updated_at as string)) {
          byPosition.set(dest.base_position, dest)
        }
      }
      handled = true
    }

    if (dest.world_name) {
      // For worlds: normalize to lowercase and keep most recent
      const normalizedName = dest.world_name.toLowerCase()
      const existing = byWorldNormalized.get(normalizedName)
      if (!existing) {
        byWorldNormalized.set(normalizedName, dest)
      } else if (dest.updated_at && existing.updated_at) {
        if (new Date(dest.updated_at as string) > new Date(existing.updated_at as string)) {
          byWorldNormalized.set(normalizedName, dest)
        }
      }
      handled = true
    }

    if (!handled) {
      // Destination has neither position nor world - keep it (dedup by ID later)
      byIdOnly.push(dest)
    }
  }

  // Merge results and deduplicate by ID
  const result = new Map<string, Destination>()
  for (const dest of byIdOnly) {
    result.set(dest.id, dest)
  }
  for (const dest of byPosition.values()) {
    result.set(dest.id, dest)
  }
  for (const dest of byWorldNormalized.values()) {
    result.set(dest.id, dest)
  }

  return Array.from(result.values())
}

export async function createDestinationsApiComponent(
  components: Components
): Promise<IDestinationsApiComponent> {
  const { fetch, config, cache, logs } = components
  const logger = logs.getLogger('destinations-api')

  const apiUrl = await config.getString('DESTINATIONS_API_URL')
    ?? 'https://places.decentraland.org/api/destinations'
  const ttl = parseInt(await config.getString('DESTINATIONS_CACHE_TTL_MS') ?? '7200000')

  async function getForPlaces(places: Place[], queryString?: string): Promise<DestinationsResponse> {
    if (places.length === 0) {
      return { ok: true, data: [], total: 0 }
    }

    // Use fetchFromApi for all queries - it has caching that preserves API order
    return fetchFromApi(places, queryString || '')
  }

  async function fetchFromApi(places: Place[], queryString: string): Promise<DestinationsResponse> {
    const startTotal = Date.now()

    // Parse queryString to check for user-provided filters
    const params = new URLSearchParams(queryString)
    const userPointers = params.getAll('pointer')
    const userWorldNames = params.getAll('world_names')
    const onlyPlaces = params.get('only_places') === 'true'
    const onlyWorlds = params.get('only_worlds') === 'true'

    // Filter places based on user-provided filters
    let filteredPlaces = places

    // If user specified pointers, only include places at those positions
    if (userPointers.length > 0) {
      const pointerSet = new Set(userPointers)
      filteredPlaces = filteredPlaces.filter(p =>
        p.type === 'world' || (p.basePosition && pointerSet.has(p.basePosition))
      )
    }

    // If user specified world_names, only include those worlds
    if (userWorldNames.length > 0) {
      const worldSet = new Set(userWorldNames.map(w => w.toLowerCase()))
      filteredPlaces = filteredPlaces.filter(p =>
        p.type === 'scene' || (p.worldName && worldSet.has(p.worldName.toLowerCase()))
      )
    }

    // If user specified only_places/only_worlds, filter accordingly
    if (onlyPlaces) {
      filteredPlaces = filteredPlaces.filter(p => p.type === 'scene')
    }
    if (onlyWorlds) {
      filteredPlaces = filteredPlaces.filter(p => p.type === 'world')
    }

    const positions = filteredPlaces
      .filter(p => p.type === 'scene' && p.basePosition)
      .map(p => p.basePosition!)
      .sort()

    const worlds = filteredPlaces
      .filter(p => p.type === 'world' && p.worldName)
      .map(p => p.worldName!)
      .sort()

    // Create a cache key from positions + worlds + queryString
    const cacheKey = `query:places:${positions.join(',')}:${worlds.join(',')}:${queryString}`

    // Check cache first - get list of destination IDs
    const startCacheRead = Date.now()
    const cachedKeys = await cache.get<string[]>(cacheKey)
    if (cachedKeys) {
      const destinations = await Promise.all(
        cachedKeys.map(key => cache.get<Destination>(key))
      )
      const valid = destinations.filter((d): d is Destination => d !== null)

      if (valid.length === cachedKeys.length) {
        const cacheReadMs = Date.now() - startCacheRead
        const totalMs = Date.now() - startTotal
        logger.info('getForPlaces (queryString cache hit)', {
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

    const allDestinations: Destination[] = []
    let placesMs = 0
    let worldsMs = 0

    try {
      if (positions.length > 0) {
        const placesParams = new URLSearchParams(queryString)
        placesParams.set('only_places', 'true')
        // Remove any existing pointer params and add our filtered ones
        placesParams.delete('pointer')
        for (const pos of positions) {
          placesParams.append('pointer', pos)
        }

        const startPlaces = Date.now()
        const placesResponse = await fetch.fetch(`${apiUrl}?${placesParams}`)
        placesMs = Date.now() - startPlaces

        if (placesResponse.ok) {
          const placesData = await placesResponse.json() as DestinationsResponse
          if (placesData.data) {
            allDestinations.push(...deduplicateDestinations(placesData.data))
          }
        } else {
          logger.warn('Places API error', { status: placesResponse.status })
        }
      }

      if (worlds.length > 0) {
        const worldsParams = new URLSearchParams(queryString)
        worldsParams.set('only_worlds', 'true')
        // Remove any existing world_names params and add our filtered ones
        worldsParams.delete('world_names')
        for (const world of worlds) {
          worldsParams.append('world_names', world)
        }

        const startWorlds = Date.now()
        const worldsResponse = await fetch.fetch(`${apiUrl}?${worldsParams}`)
        worldsMs = Date.now() - startWorlds

        if (worldsResponse.ok) {
          const worldsData = await worldsResponse.json() as DestinationsResponse
          if (worldsData.data) {
            allDestinations.push(...deduplicateDestinations(worldsData.data))
          }
        } else {
          logger.warn('Worlds API error', { status: worldsResponse.status })
        }
      }

      // Final deduplication by ID
      const dedupedDestinations = deduplicateDestinations(allDestinations)

      // Cache results by ID, then store the list of IDs for this query
      const startCacheWrite = Date.now()
      const keys = await Promise.all(dedupedDestinations.map(async dest => {
        const key = destIdCacheKey(dest.id)
        await cache.set(key, dest, ttl)
        return key
      }))
      await cache.set(cacheKey, keys, ttl)
      const cacheWriteMs = Date.now() - startCacheWrite

      const totalMs = Date.now() - startTotal
      logger.info('getForPlaces (queryString fetched)', {
        positions: positions.length,
        worlds: worlds.length,
        results: dedupedDestinations.length,
        cacheReadMs,
        placesMs,
        worldsMs,
        cacheWriteMs,
        totalMs
      })

      return { ok: true, data: dedupedDestinations, total: dedupedDestinations.length }
    } catch (error) {
      logger.error('Fetch error', { error: (error as Error).message })
      return { ok: false, data: [], total: 0 }
    }
  }

  async function proxyQuery(queryString: string): Promise<DestinationsResponse> {
    const startTotal = Date.now()
    const queryKey = `query:${queryString}`

    const startCacheRead = Date.now()
    const cachedKeys = await cache.get<string[]>(queryKey)
    if (cachedKeys) {
      const destinations = await Promise.all(
        cachedKeys.map(key => cache.get<Destination>(key))
      )
      const valid = destinations.filter((d): d is Destination => d !== null)

      if (valid.length === cachedKeys.length) {
        const cacheReadMs = Date.now() - startCacheRead
        logger.info('proxyQuery cache hit', { results: valid.length, cacheReadMs })
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
      const data = await response.json() as DestinationsResponse
      const parseMs = Date.now() - startParse

      const startCacheWrite = Date.now()
      const keys = await Promise.all(data.data.map(async dest => {
        const key = destIdCacheKey(dest.id)
        await cache.set(key, dest, ttl)
        return key
      }))
      await cache.set(queryKey, keys, ttl)
      const cacheWriteMs = Date.now() - startCacheWrite

      const totalMs = Date.now() - startTotal
      logger.info('proxyQuery', {
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

  return { getForPlaces, proxyQuery }
}
