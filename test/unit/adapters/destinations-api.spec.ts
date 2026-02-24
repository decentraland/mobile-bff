import { createDestinationsApiComponent, Destination } from '../../../src/adapters/destinations-api'
import { createCacheMockComponent } from '../../mocks/cache-mock'
import { createFetchMockComponent, createMockResponse } from '../../mocks/fetch-mock'
import { createConfigJestMockComponent } from '../../mocks/config-mock'
import { createLogsMockComponent } from '../../mocks/logs-mock'
import { createTestPlace, createTestWorldPlace } from '../../mocks/places-db-mock'

describe('destinations-api adapter', () => {
  let mockCache: ReturnType<typeof createCacheMockComponent>
  let mockFetch: ReturnType<typeof createFetchMockComponent>
  let mockConfig: ReturnType<typeof createConfigJestMockComponent>
  let mockLogs: ReturnType<typeof createLogsMockComponent>

  beforeEach(() => {
    mockCache = createCacheMockComponent()
    mockFetch = createFetchMockComponent()
    mockConfig = createConfigJestMockComponent({
      'DESTINATIONS_API_URL': 'https://api.test.com/destinations',
      'DESTINATIONS_CACHE_TTL_MS': '3600000'
    })
    mockLogs = createLogsMockComponent()
  })

  describe('getForPlaces', () => {
    it('should return empty response for empty places', async () => {
      const api = await createDestinationsApiComponent({
        fetch: mockFetch,
        config: mockConfig,
        cache: mockCache,
        logs: mockLogs
      })

      const result = await api.getForPlaces([])

      expect(result).toEqual({ ok: true, data: [], total: 0 })
      expect(mockFetch.fetch).not.toHaveBeenCalled()
    })

    it('should fetch places with only_places=true', async () => {
      const place = createTestPlace({ basePosition: '10,20' })
      const apiDest: Destination = { id: 'd1', title: 'Fetched', base_position: '10,20' }

      mockFetch.fetch.mockResolvedValue(
        createMockResponse({ ok: true, data: [apiDest], total: 1 })
      )

      const api = await createDestinationsApiComponent({
        fetch: mockFetch,
        config: mockConfig,
        cache: mockCache,
        logs: mockLogs
      })

      const result = await api.getForPlaces([place])

      expect(result).toEqual({ ok: true, data: [apiDest], total: 1 })
      expect(mockFetch.fetch).toHaveBeenCalledWith(
        'https://api.test.com/destinations?only_places=true&pointer=10%2C20',
        { headers: undefined }
      )
    })

    it('should fetch and cache destinations by ID with query mapping', async () => {
      const place = createTestPlace({ basePosition: '0,0' })
      const apiDest: Destination = { id: 'd1', title: 'Fetched', base_position: '0,0' }

      mockFetch.fetch.mockResolvedValue(
        createMockResponse({ ok: true, data: [apiDest], total: 1 })
      )

      const api = await createDestinationsApiComponent({
        fetch: mockFetch,
        config: mockConfig,
        cache: mockCache,
        logs: mockLogs
      })

      await api.getForPlaces([place])

      expect(mockCache.set).toHaveBeenCalledWith('dest:id:d1', apiDest, 3600000)
      expect(mockCache.set).toHaveBeenCalledWith('query:places:0,0::', ['dest:id:d1'], 3600000)
    })

    it('should handle multiple places in single request', async () => {
      const place1 = createTestPlace({ basePosition: '0,0' })
      const place2 = createTestPlace({ basePosition: '10,20' })
      const dest1: Destination = { id: 'd1', title: 'Dest1', base_position: '0,0' }
      const dest2: Destination = { id: 'd2', title: 'Dest2', base_position: '10,20' }

      mockFetch.fetch.mockResolvedValue(
        createMockResponse({ ok: true, data: [dest1, dest2], total: 2 })
      )

      const api = await createDestinationsApiComponent({
        fetch: mockFetch,
        config: mockConfig,
        cache: mockCache,
        logs: mockLogs
      })

      const result = await api.getForPlaces([place1, place2])

      expect(result.data).toContainEqual(dest1)
      expect(result.data).toContainEqual(dest2)
      expect(mockFetch.fetch).toHaveBeenCalledWith(
        'https://api.test.com/destinations?only_places=true&pointer=0%2C0&pointer=10%2C20',
        { headers: undefined }
      )
    })

    it('should fetch worlds with only_worlds=true', async () => {
      const worldPlace = createTestWorldPlace({ worldName: 'cool.dcl.eth' })
      const worldDest: Destination = { id: 'd1', title: 'World', world_name: 'cool.dcl.eth' }

      mockFetch.fetch.mockResolvedValue(
        createMockResponse({ ok: true, data: [worldDest], total: 1 })
      )

      const api = await createDestinationsApiComponent({
        fetch: mockFetch,
        config: mockConfig,
        cache: mockCache,
        logs: mockLogs
      })

      const result = await api.getForPlaces([worldPlace])

      expect(result).toEqual({ ok: true, data: [worldDest], total: 1 })
      expect(mockFetch.fetch).toHaveBeenCalledWith(
        'https://api.test.com/destinations?only_worlds=true&world_names=cool.dcl.eth',
        { headers: undefined }
      )
      expect(mockCache.set).toHaveBeenCalledWith('dest:id:d1', worldDest, 3600000)
      expect(mockCache.set).toHaveBeenCalledWith('query:places::cool.dcl.eth:', ['dest:id:d1'], 3600000)
    })

    it('should make two separate requests for mixed scenes and worlds', async () => {
      const scene = createTestPlace({ basePosition: '5,5' })
      const world = createTestWorldPlace({ worldName: 'my.dcl.eth' })
      const sceneDest: Destination = { id: 'd1', title: 'Scene', base_position: '5,5' }
      const worldDest: Destination = { id: 'd2', title: 'World', world_name: 'my.dcl.eth' }

      mockFetch.fetch
        .mockResolvedValueOnce(createMockResponse({ ok: true, data: [sceneDest], total: 1 }))
        .mockResolvedValueOnce(createMockResponse({ ok: true, data: [worldDest], total: 1 }))

      const api = await createDestinationsApiComponent({
        fetch: mockFetch,
        config: mockConfig,
        cache: mockCache,
        logs: mockLogs
      })

      const result = await api.getForPlaces([scene, world])

      expect(mockFetch.fetch).toHaveBeenCalledTimes(2)
      expect(mockFetch.fetch).toHaveBeenNthCalledWith(1,
        'https://api.test.com/destinations?only_places=true&pointer=5%2C5',
        { headers: undefined }
      )
      expect(mockFetch.fetch).toHaveBeenNthCalledWith(2,
        'https://api.test.com/destinations?only_worlds=true&world_names=my.dcl.eth',
        { headers: undefined }
      )
      expect(result.data).toContainEqual(sceneDest)
      expect(result.data).toContainEqual(worldDest)
      expect(result.total).toBe(2)
    })

    it('should return empty data on API error for places', async () => {
      const place = createTestPlace({ basePosition: '0,0' })

      mockFetch.fetch.mockResolvedValue(createMockResponse({}, false, 500))

      const api = await createDestinationsApiComponent({
        fetch: mockFetch,
        config: mockConfig,
        cache: mockCache,
        logs: mockLogs
      })

      const result = await api.getForPlaces([place])

      expect(result).toEqual({ ok: true, data: [], total: 0 })
    })

    it('should return error response on fetch exception', async () => {
      const place = createTestPlace({ basePosition: '0,0' })

      mockFetch.fetch.mockRejectedValue(new Error('Network error'))

      const api = await createDestinationsApiComponent({
        fetch: mockFetch,
        config: mockConfig,
        cache: mockCache,
        logs: mockLogs
      })

      const result = await api.getForPlaces([place])

      expect(result).toEqual({ ok: false, data: [], total: 0 })
    })

    it('should pass query string to both requests', async () => {
      const scene = createTestPlace({ basePosition: '5,5' })
      const world = createTestWorldPlace({ worldName: 'my.dcl.eth' })

      mockFetch.fetch.mockResolvedValue(
        createMockResponse({ ok: true, data: [], total: 0 })
      )

      const api = await createDestinationsApiComponent({
        fetch: mockFetch,
        config: mockConfig,
        cache: mockCache,
        logs: mockLogs
      })

      await api.getForPlaces([scene, world], 'search=museum&limit=10')

      expect(mockFetch.fetch).toHaveBeenCalledTimes(2)
      expect(mockFetch.fetch).toHaveBeenNthCalledWith(1,
        'https://api.test.com/destinations?search=museum&limit=10&only_places=true&pointer=5%2C5',
        { headers: undefined }
      )
      expect(mockFetch.fetch).toHaveBeenNthCalledWith(2,
        'https://api.test.com/destinations?search=museum&limit=10&only_worlds=true&world_names=my.dcl.eth',
        { headers: undefined }
      )
    })

    it('should include order_by and offset from query string', async () => {
      const place = createTestPlace({ basePosition: '0,0' })

      mockFetch.fetch.mockResolvedValue(
        createMockResponse({ ok: true, data: [], total: 0 })
      )

      const api = await createDestinationsApiComponent({
        fetch: mockFetch,
        config: mockConfig,
        cache: mockCache,
        logs: mockLogs
      })

      await api.getForPlaces([place], 'order_by=most_active&limit=5&offset=10')

      expect(mockFetch.fetch).toHaveBeenCalledWith(
        'https://api.test.com/destinations?order_by=most_active&limit=5&offset=10&only_places=true&pointer=0%2C0',
        { headers: undefined }
      )
    })

    it('should work with empty query string', async () => {
      const place = createTestPlace({ basePosition: '0,0' })

      mockFetch.fetch.mockResolvedValue(
        createMockResponse({ ok: true, data: [], total: 0 })
      )

      const api = await createDestinationsApiComponent({
        fetch: mockFetch,
        config: mockConfig,
        cache: mockCache,
        logs: mockLogs
      })

      await api.getForPlaces([place], '')

      expect(mockFetch.fetch).toHaveBeenCalledWith(
        'https://api.test.com/destinations?only_places=true&pointer=0%2C0',
        { headers: undefined }
      )
    })

    it('should filter places by pointer when pointer is in queryString', async () => {
      const place1 = createTestPlace({ basePosition: '0,0' })
      const place2 = createTestPlace({ basePosition: '10,20' })
      const place3 = createTestPlace({ basePosition: '30,40' })
      const apiDest: Destination = { id: 'd1', title: 'Filtered', base_position: '10,20' }

      mockCache.get.mockResolvedValue(null)
      mockFetch.fetch.mockResolvedValue(
        createMockResponse({ ok: true, data: [apiDest], total: 1 })
      )

      const api = await createDestinationsApiComponent({
        fetch: mockFetch,
        config: mockConfig,
        cache: mockCache,
        logs: mockLogs
      })

      // Query with pointer=10,20 should filter places to only that position
      const result = await api.getForPlaces([place1, place2, place3], 'pointer=10,20')

      expect(result).toEqual({ ok: true, data: [apiDest], total: 1 })
      // Should only request the filtered position, not all three
      expect(mockFetch.fetch).toHaveBeenCalledWith(
        'https://api.test.com/destinations?only_places=true&pointer=10%2C20',
        { headers: undefined }
      )
    })

    it('should filter to scenes only when only_places is in queryString', async () => {
      const scene = createTestPlace({ basePosition: '5,5' })
      const world = createTestWorldPlace({ worldName: 'my.dcl.eth' })

      mockCache.get.mockResolvedValue(null)
      mockFetch.fetch.mockResolvedValue(
        createMockResponse({ ok: true, data: [], total: 0 })
      )

      const api = await createDestinationsApiComponent({
        fetch: mockFetch,
        config: mockConfig,
        cache: mockCache,
        logs: mockLogs
      })

      await api.getForPlaces([scene, world], 'only_places=true')

      // Should only make one request for scenes, not for worlds
      expect(mockFetch.fetch).toHaveBeenCalledTimes(1)
      expect(mockFetch.fetch).toHaveBeenCalledWith(
        'https://api.test.com/destinations?only_places=true&pointer=5%2C5',
        { headers: undefined }
      )
    })

    it('should return cached destinations without fetching', async () => {
      const place = createTestPlace({ basePosition: '0,0' })
      const cachedDest: Destination = { id: 'd1', title: 'Cached', base_position: '0,0' }

      mockCache.get
        .mockResolvedValueOnce(['dest:id:d1']) // query:places:0,0:: -> list of keys
        .mockResolvedValueOnce(cachedDest) // dest:id:d1

      const api = await createDestinationsApiComponent({
        fetch: mockFetch,
        config: mockConfig,
        cache: mockCache,
        logs: mockLogs
      })

      const result = await api.getForPlaces([place])

      expect(result).toEqual({ ok: true, data: [cachedDest], total: 1 })
      expect(mockFetch.fetch).not.toHaveBeenCalled()
    })

    it('should cache results when queryString is present', async () => {
      const place = createTestPlace({ basePosition: '0,0' })
      const apiDest: Destination = { id: 'd1', title: 'API', base_position: '0,0' }

      mockCache.get.mockResolvedValue(null) // Cache miss

      mockFetch.fetch.mockResolvedValue(
        createMockResponse({ ok: true, data: [apiDest], total: 1 })
      )

      const api = await createDestinationsApiComponent({
        fetch: mockFetch,
        config: mockConfig,
        cache: mockCache,
        logs: mockLogs
      })

      const result = await api.getForPlaces([place], 'search=museum')

      expect(result).toEqual({ ok: true, data: [apiDest], total: 1 })
      // Should check cache first
      expect(mockCache.get).toHaveBeenCalledWith('query:places:0,0::search=museum')
      // Should fetch from API on cache miss
      expect(mockFetch.fetch).toHaveBeenCalledWith(
        'https://api.test.com/destinations?search=museum&only_places=true&pointer=0%2C0',
        { headers: undefined }
      )
      // Should cache the result
      expect(mockCache.set).toHaveBeenCalledWith('dest:id:d1', apiDest, 3600000)
      expect(mockCache.set).toHaveBeenCalledWith('query:places:0,0::search=museum', ['dest:id:d1'], 3600000)
    })

    it('should return cached results when queryString cache hit', async () => {
      const place = createTestPlace({ basePosition: '0,0' })
      const cachedDest: Destination = { id: 'd1', title: 'Cached', base_position: '0,0' }

      mockCache.get
        .mockResolvedValueOnce(['dest:id:d1']) // Cache hit for query key
        .mockResolvedValueOnce(cachedDest) // Cache hit for destination

      const api = await createDestinationsApiComponent({
        fetch: mockFetch,
        config: mockConfig,
        cache: mockCache,
        logs: mockLogs
      })

      const result = await api.getForPlaces([place], 'search=museum')

      expect(result).toEqual({ ok: true, data: [cachedDest], total: 1 })
      // Should not fetch from API
      expect(mockFetch.fetch).not.toHaveBeenCalled()
    })

    it('should handle mixed cached scenes and worlds', async () => {
      const scene = createTestPlace({ basePosition: '5,5' })
      const world = createTestWorldPlace({ worldName: 'cached.dcl.eth' })
      const cachedScene: Destination = { id: 'd1', title: 'Scene', base_position: '5,5' }
      const cachedWorld: Destination = { id: 'd2', title: 'World', world_name: 'cached.dcl.eth' }

      mockCache.get
        .mockResolvedValueOnce(['dest:id:d1', 'dest:id:d2']) // query:places:5,5:cached.dcl.eth: -> list of keys
        .mockResolvedValueOnce(cachedScene) // dest:id:d1
        .mockResolvedValueOnce(cachedWorld) // dest:id:d2

      const api = await createDestinationsApiComponent({
        fetch: mockFetch,
        config: mockConfig,
        cache: mockCache,
        logs: mockLogs
      })

      const result = await api.getForPlaces([scene, world])

      expect(result.data).toContainEqual(cachedScene)
      expect(result.data).toContainEqual(cachedWorld)
      expect(result.total).toBe(2)
      expect(mockFetch.fetch).not.toHaveBeenCalled()
    })

    it('should deduplicate destinations for same position keeping first', async () => {
      const place = createTestPlace({ basePosition: '0,0' })
      const dest1: Destination = { id: 'd1', title: 'Dest1', base_position: '0,0' }
      const dest2: Destination = { id: 'd2', title: 'Dest2', base_position: '0,0' }

      mockCache.get.mockResolvedValue(null)
      mockFetch.fetch.mockResolvedValue(
        createMockResponse({ ok: true, data: [dest1, dest2], total: 2 })
      )

      const api = await createDestinationsApiComponent({
        fetch: mockFetch,
        config: mockConfig,
        cache: mockCache,
        logs: mockLogs
      })

      const result = await api.getForPlaces([place])

      // Should deduplicate to 1 destination per position
      expect(result.data).toHaveLength(1)
      expect(result.data[0].id).toBe('d1') // First one wins when no updated_at
    })

    it('should deduplicate destinations for same position keeping most recent', async () => {
      const place = createTestPlace({ basePosition: '0,0' })
      const dest1: Destination = {
        id: 'd1',
        title: 'Dest1',
        base_position: '0,0',
        updated_at: '2024-01-01T00:00:00.000Z'
      }
      const dest2: Destination = {
        id: 'd2',
        title: 'Dest2',
        base_position: '0,0',
        updated_at: '2026-01-01T00:00:00.000Z' // More recent
      }

      mockCache.get.mockResolvedValue(null)
      mockFetch.fetch.mockResolvedValue(
        createMockResponse({ ok: true, data: [dest1, dest2], total: 2 })
      )

      const api = await createDestinationsApiComponent({
        fetch: mockFetch,
        config: mockConfig,
        cache: mockCache,
        logs: mockLogs
      })

      const result = await api.getForPlaces([place])

      // Should keep the most recently updated
      expect(result.data).toHaveLength(1)
      expect(result.data[0].id).toBe('d2')
    })

    it('should return cached destinations for same position', async () => {
      const place = createTestPlace({ basePosition: '0,0' })
      const dest1: Destination = { id: 'd1', title: 'Dest1', base_position: '0,0' }
      const dest2: Destination = { id: 'd2', title: 'Dest2', base_position: '0,0' }

      mockCache.get
        .mockResolvedValueOnce(['dest:id:d1', 'dest:id:d2']) // query:places:0,0:: -> list of keys
        .mockResolvedValueOnce(dest1) // dest:id:d1
        .mockResolvedValueOnce(dest2) // dest:id:d2

      const api = await createDestinationsApiComponent({
        fetch: mockFetch,
        config: mockConfig,
        cache: mockCache,
        logs: mockLogs
      })

      const result = await api.getForPlaces([place])

      // Should return all cached destinations as-is (dedup happened at cache time)
      expect(result.data).toHaveLength(2)
      expect(mockFetch.fetch).not.toHaveBeenCalled()
    })

    it('should preserve destinations without position or world', async () => {
      const place = createTestPlace({ basePosition: '0,0' })
      // Simulating a search result that might not have position/world populated
      const dest1: Destination = { id: 'd1', title: 'Result without position' }
      const dest2: Destination = { id: 'd2', title: 'Result with position', base_position: '0,0' }

      mockCache.get.mockResolvedValue(null)
      mockFetch.fetch.mockResolvedValue(
        createMockResponse({ ok: true, data: [dest1, dest2], total: 2 })
      )

      const api = await createDestinationsApiComponent({
        fetch: mockFetch,
        config: mockConfig,
        cache: mockCache,
        logs: mockLogs
      })

      const result = await api.getForPlaces([place])

      // Both should be preserved - dest1 has no position/world but should not be dropped
      expect(result.data).toHaveLength(2)
      expect(result.data.find(d => d.id === 'd1')).toBeDefined()
      expect(result.data.find(d => d.id === 'd2')).toBeDefined()
    })

    it('should deduplicate worlds with different casing', async () => {
      const world = createTestWorldPlace({ worldName: 'tophub.dcl.eth' })

      const dest1: Destination = {
        id: 'd1',
        title: 'TOPHUB',
        world_name: 'tophub.dcl.eth',
        updated_at: '2024-01-01T00:00:00.000Z'
      }
      const dest2: Destination = {
        id: 'd2',
        title: 'TOPHUB',
        world_name: 'TOPHUB.dcl.eth',
        updated_at: '2026-01-01T00:00:00.000Z'  // More recent
      }

      mockCache.get.mockResolvedValue(null)
      mockFetch.fetch.mockResolvedValue(
        createMockResponse({ ok: true, data: [dest1, dest2], total: 2 })
      )

      const api = await createDestinationsApiComponent({
        fetch: mockFetch,
        config: mockConfig,
        cache: mockCache,
        logs: mockLogs
      })

      const result = await api.getForPlaces([world])

      // Should only have 1 destination (most recent)
      expect(result.data).toHaveLength(1)
      expect(result.data[0].id).toBe('d2')
    })

    it('should refetch if some destinations expired', async () => {
      const place1 = createTestPlace({ basePosition: '0,0' })
      const place2 = createTestPlace({ basePosition: '10,20' })
      const dest1: Destination = { id: 'd1', title: 'Dest1', base_position: '0,0' }
      const dest2: Destination = { id: 'd2', title: 'Dest2', base_position: '10,20' }

      mockCache.get
        .mockResolvedValueOnce(['dest:id:d1', 'dest:id:d2']) // query:places:0,0,10,20:: -> list of keys
        .mockResolvedValueOnce(dest1) // dest:id:d1
        .mockResolvedValueOnce(null) // dest:id:d2 expired

      mockFetch.fetch.mockResolvedValue(
        createMockResponse({ ok: true, data: [dest1, dest2], total: 2 })
      )

      const api = await createDestinationsApiComponent({
        fetch: mockFetch,
        config: mockConfig,
        cache: mockCache,
        logs: mockLogs
      })

      const result = await api.getForPlaces([place1, place2])

      expect(result.data).toHaveLength(2)
      expect(mockFetch.fetch).toHaveBeenCalled()
    })
  })

  describe('proxyQuery', () => {
    it('should return cached query results when all destinations are cached', async () => {
      const keys = ['dest:id:d1', 'dest:id:d2']
      const dest1: Destination = { id: 'd1', title: 'D1', base_position: '0,0' }
      const dest2: Destination = { id: 'd2', title: 'D2', base_position: '10,20' }

      mockCache.get
        .mockResolvedValueOnce(keys)
        .mockResolvedValueOnce(dest1)
        .mockResolvedValueOnce(dest2)

      const api = await createDestinationsApiComponent({
        fetch: mockFetch,
        config: mockConfig,
        cache: mockCache,
        logs: mockLogs
      })

      const result = await api.proxyQuery('limit=10')

      expect(result).toEqual({ ok: true, data: [dest1, dest2], total: 2 })
      expect(mockFetch.fetch).not.toHaveBeenCalled()
    })

    it('should fetch from API on cache miss', async () => {
      const apiDest: Destination = { id: 'd1', title: 'API', base_position: '0,0' }

      mockCache.get.mockResolvedValue(null)
      mockFetch.fetch.mockResolvedValue(
        createMockResponse({ ok: true, data: [apiDest], total: 1 })
      )

      const api = await createDestinationsApiComponent({
        fetch: mockFetch,
        config: mockConfig,
        cache: mockCache,
        logs: mockLogs
      })

      const result = await api.proxyQuery('limit=5&order_by=most_active')

      expect(result.data).toEqual([apiDest])
      expect(mockFetch.fetch).toHaveBeenCalledWith(
        'https://api.test.com/destinations/?limit=5&order_by=most_active',
        { headers: undefined }
      )
    })

    it('should cache query keys and destinations after fetch', async () => {
      const apiDest: Destination = { id: 'd1', title: 'API', base_position: '0,0' }

      mockCache.get.mockResolvedValue(null)
      mockFetch.fetch.mockResolvedValue(
        createMockResponse({ ok: true, data: [apiDest], total: 1 })
      )

      const api = await createDestinationsApiComponent({
        fetch: mockFetch,
        config: mockConfig,
        cache: mockCache,
        logs: mockLogs
      })

      await api.proxyQuery('test=1')

      expect(mockCache.set).toHaveBeenCalledWith('dest:id:d1', apiDest, 3600000)
      expect(mockCache.set).toHaveBeenCalledWith('query:test=1', ['dest:id:d1'], 3600000)
    })

    it('should refetch on partial cache hit', async () => {
      const keys = ['dest:id:d1', 'dest:id:d2']
      const dest1: Destination = { id: 'd1', title: 'D1', base_position: '0,0' }
      const apiDest1: Destination = { id: 'd1', title: 'API D1', base_position: '0,0' }
      const apiDest2: Destination = { id: 'd2', title: 'API D2', base_position: '10,20' }

      mockCache.get
        .mockResolvedValueOnce(keys)
        .mockResolvedValueOnce(dest1)
        .mockResolvedValueOnce(null) // second destination missing

      mockFetch.fetch.mockResolvedValue(
        createMockResponse({ ok: true, data: [apiDest1, apiDest2], total: 2 })
      )

      const api = await createDestinationsApiComponent({
        fetch: mockFetch,
        config: mockConfig,
        cache: mockCache,
        logs: mockLogs
      })

      const result = await api.proxyQuery('limit=10')

      expect(mockFetch.fetch).toHaveBeenCalled()
      expect(result.data).toEqual([apiDest1, apiDest2])
    })

    it('should handle empty query string', async () => {
      mockCache.get.mockResolvedValue(null)
      mockFetch.fetch.mockResolvedValue(
        createMockResponse({ ok: true, data: [], total: 0 })
      )

      const api = await createDestinationsApiComponent({
        fetch: mockFetch,
        config: mockConfig,
        cache: mockCache,
        logs: mockLogs
      })

      await api.proxyQuery('')

      expect(mockFetch.fetch).toHaveBeenCalledWith('https://api.test.com/destinations', { headers: undefined })
    })

    it('should return error response on fetch failure', async () => {
      mockCache.get.mockResolvedValue(null)
      mockFetch.fetch.mockRejectedValue(new Error('Network error'))

      const api = await createDestinationsApiComponent({
        fetch: mockFetch,
        config: mockConfig,
        cache: mockCache,
        logs: mockLogs
      })

      const result = await api.proxyQuery('test=1')

      expect(result).toEqual({ ok: false, data: [], total: 0 })
    })

    it('should use default config values', async () => {
      const emptyConfig = createConfigJestMockComponent({})

      mockCache.get.mockResolvedValue(null)
      mockFetch.fetch.mockResolvedValue(
        createMockResponse({ ok: true, data: [], total: 0 })
      )

      const api = await createDestinationsApiComponent({
        fetch: mockFetch,
        config: emptyConfig,
        cache: mockCache,
        logs: mockLogs
      })

      await api.proxyQuery('test=1')

      expect(mockFetch.fetch).toHaveBeenCalledWith(
        'https://places.decentraland.org/api/destinations/?test=1',
        { headers: undefined }
      )
    })
  })
})
