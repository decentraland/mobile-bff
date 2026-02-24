import { getEventsHandler, Event, EventsResponse } from '../../../src/controllers/handlers/events/get-events-handler'
import { createPlacesDbMockComponent, createTestPlace, createTestWorldPlace } from '../../mocks/places-db-mock'
import { createCacheMockComponent } from '../../mocks/cache-mock'
import { createFetchMockComponent, createMockResponse } from '../../mocks/fetch-mock'
import { createConfigJestMockComponent } from '../../mocks/config-mock'
import { createLogsMockComponent } from '../../mocks/logs-mock'

function createTestEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 'test-event-id',
    name: 'Test Event',
    ...overrides
  }
}

function createEventsResponse(events: Event[]): EventsResponse {
  return {
    ok: true,
    data: events,
    total: events.length
  }
}

describe('get-events-handler', () => {
  let mockPlacesDb: ReturnType<typeof createPlacesDbMockComponent>
  let mockCache: ReturnType<typeof createCacheMockComponent>
  let mockFetch: ReturnType<typeof createFetchMockComponent>
  let mockConfig: ReturnType<typeof createConfigJestMockComponent>
  let mockLogs: ReturnType<typeof createLogsMockComponent>

  beforeEach(() => {
    mockPlacesDb = createPlacesDbMockComponent()
    mockCache = createCacheMockComponent()
    mockFetch = createFetchMockComponent()
    mockConfig = createConfigJestMockComponent({
      EVENTS_API_URL: 'https://events.decentraland.org/api/events',
      EVENTS_CACHE_TTL_MS: '7200000'
    })
    mockLogs = createLogsMockComponent()

    // Default cache behavior: always miss
    mockCache.get.mockResolvedValue(null)
    mockCache.set.mockResolvedValue(undefined)
  })

  function createContext(url: string) {
    return {
      components: {
        placesDb: mockPlacesDb,
        cache: mockCache,
        fetch: mockFetch,
        config: mockConfig,
        logs: mockLogs
      },
      url: new URL(url)
    }
  }

  describe('tag mode (with ?tag=)', () => {
    describe('when tag parameter is valid', () => {
      it('should query places by tag and return matching events', async () => {
        const places = [
          createTestPlace({ id: 'p1', basePosition: '0,0', positions: ['0,0', '0,1'] }),
          createTestPlace({ id: 'p2', basePosition: '10,20', positions: ['10,20'] })
        ]
        const events = [
          createTestEvent({ id: 'e1', name: 'Event at 0,0', position: [0, 0] }),
          createTestEvent({ id: 'e2', name: 'Event at 10,20', position: [10, 20] }),
          createTestEvent({ id: 'e3', name: 'Event elsewhere', position: [99, 99] })
        ]

        mockPlacesDb.getAllPlaces.mockResolvedValue(places)
        mockFetch.fetch.mockResolvedValue(createMockResponse(createEventsResponse(events)))

        const context = createContext('http://localhost/events?tag=allowed_ios')
        const response = await getEventsHandler(context as any)

        expect(response.status).toBe(200)
        const body = response.body as EventsResponse
        expect(body.data).toHaveLength(2)
        expect(body.data.map(e => e.id)).toEqual(['e1', 'e2'])
        expect(mockPlacesDb.getAllPlaces).toHaveBeenCalledWith(['allowed_ios'])
      })

      it('should match events on any parcel of a place, not just basePosition', async () => {
        const places = [
          createTestPlace({ id: 'p1', basePosition: '0,0', positions: ['0,0', '1,0', '0,1'] })
        ]
        const events = [
          createTestEvent({ id: 'e1', name: 'Event on adjacent parcel', position: [1, 0] }),
          createTestEvent({ id: 'e2', name: 'Event elsewhere', position: [50, 50] })
        ]

        mockPlacesDb.getAllPlaces.mockResolvedValue(places)
        mockFetch.fetch.mockResolvedValue(createMockResponse(createEventsResponse(events)))

        const context = createContext('http://localhost/events?tag=allowed_ios')
        const response = await getEventsHandler(context as any)

        const body = response.body as EventsResponse
        expect(body.data).toHaveLength(1)
        expect(body.data[0].id).toBe('e1')
      })

      it('should handle multiple comma-separated tags', async () => {
        mockPlacesDb.getAllPlaces.mockResolvedValue([])

        const context = createContext('http://localhost/events?tag=allowed_ios,featured')
        const response = await getEventsHandler(context as any)

        expect(response.status).toBe(200)
        expect(mockPlacesDb.getAllPlaces).toHaveBeenCalledWith(['allowed_ios', 'featured'])
      })

      it('should trim whitespace from tags', async () => {
        mockPlacesDb.getAllPlaces.mockResolvedValue([])

        const context = createContext('http://localhost/events?tag=%20allowed_ios%20,%20featured%20')
        const response = await getEventsHandler(context as any)

        expect(response.status).toBe(200)
        expect(mockPlacesDb.getAllPlaces).toHaveBeenCalledWith(['allowed_ios', 'featured'])
      })

      it('should return empty array when no places match the tag', async () => {
        mockPlacesDb.getAllPlaces.mockResolvedValue([])

        const context = createContext('http://localhost/events?tag=nonexistent_tag')
        const response = await getEventsHandler(context as any)

        expect(response.status).toBe(200)
        expect(response.body).toEqual({ ok: true, data: [], total: 0 })
      })

      it('should match world events by server name', async () => {
        const places = [createTestWorldPlace({ worldName: 'cool-world.dcl.eth' })]
        const events = [
          createTestEvent({ id: 'e1', name: 'World Event', world: true, server: 'cool-world.dcl.eth' }),
          createTestEvent({ id: 'e2', name: 'Other World', world: true, server: 'other.dcl.eth' }),
          createTestEvent({ id: 'e3', name: 'Scene Event', position: [5, 5] })
        ]

        mockPlacesDb.getAllPlaces.mockResolvedValue(places)
        mockFetch.fetch.mockResolvedValue(createMockResponse(createEventsResponse(events)))

        const context = createContext('http://localhost/events?tag=featured')
        const response = await getEventsHandler(context as any)

        const body = response.body as EventsResponse
        expect(body.data).toHaveLength(1)
        expect(body.data[0].id).toBe('e1')
      })

      it('should fetch all events with a single API call', async () => {
        const places = [
          createTestPlace({ id: 'p1', basePosition: '0,0', positions: ['0,0'] }),
          createTestWorldPlace({ id: 'p2', worldName: 'test-world.dcl.eth' })
        ]
        const events = [
          createTestEvent({ id: 'e1', name: 'Scene Event', position: [0, 0] }),
          createTestEvent({ id: 'e2', name: 'World Event', world: true, server: 'test-world.dcl.eth' })
        ]

        mockPlacesDb.getAllPlaces.mockResolvedValue(places)
        mockFetch.fetch.mockResolvedValue(createMockResponse(createEventsResponse(events)))

        const context = createContext('http://localhost/events?tag=allowed_ios')
        const response = await getEventsHandler(context as any)

        const body = response.body as EventsResponse
        expect(body.data).toHaveLength(2)
        expect(mockFetch.fetch).toHaveBeenCalledTimes(1)
      })

      it('should pass search parameter along with tag filtering', async () => {
        const places = [createTestPlace({ id: 'p1', basePosition: '5,5', positions: ['5,5'] })]
        const events = [createTestEvent({ id: 'e1', name: 'Music Party', position: [5, 5] })]

        mockPlacesDb.getAllPlaces.mockResolvedValue(places)
        mockFetch.fetch.mockResolvedValue(createMockResponse(createEventsResponse(events)))

        const context = createContext('http://localhost/events?tag=allowed_ios&search=music')
        const response = await getEventsHandler(context as any)

        expect(response.status).toBe(200)
        expect(mockFetch.fetch).toHaveBeenCalledWith(
          expect.stringContaining('search=music')
        )
      })

      it('should filter out events without position or world', async () => {
        const places = [createTestPlace({ id: 'p1', basePosition: '0,0', positions: ['0,0'] })]
        const events = [
          createTestEvent({ id: 'e1', name: 'Has position', position: [0, 0] }),
          createTestEvent({ id: 'e2', name: 'No position' })
        ]

        mockPlacesDb.getAllPlaces.mockResolvedValue(places)
        mockFetch.fetch.mockResolvedValue(createMockResponse(createEventsResponse(events)))

        const context = createContext('http://localhost/events?tag=allowed_ios')
        const response = await getEventsHandler(context as any)

        const body = response.body as EventsResponse
        expect(body.data).toHaveLength(1)
        expect(body.data[0].id).toBe('e1')
      })
    })

    describe('when tag parameter is empty', () => {
      it('should fall through to proxy mode for empty tag parameter', async () => {
        const events = [createTestEvent({ id: 'e1' })]
        mockFetch.fetch.mockResolvedValue(createMockResponse(createEventsResponse(events)))

        const context = createContext('http://localhost/events?tag=')
        const response = await getEventsHandler(context as any)

        expect(response.status).toBe(200)
        expect(mockPlacesDb.getAllPlaces).not.toHaveBeenCalled()
      })

      it('should return 400 for whitespace-only tag parameter', async () => {
        const context = createContext('http://localhost/events?tag=%20%20')
        const response = await getEventsHandler(context as any)

        expect(response.status).toBe(400)
        expect(response.body).toEqual({ ok: false, error: 'Invalid tag parameter' })
      })
    })
  })

  describe('proxy mode (no tag parameter)', () => {
    it('should proxy request to events API', async () => {
      const events = [
        createTestEvent({ id: 'e1' }),
        createTestEvent({ id: 'e2' })
      ]
      mockFetch.fetch.mockResolvedValue(createMockResponse(createEventsResponse(events)))

      const context = createContext('http://localhost/events')
      const response = await getEventsHandler(context as any)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ ok: true, data: events, total: 2 })
      expect(mockFetch.fetch).toHaveBeenCalledWith('https://events.decentraland.org/api/events')
    })

    it('should pass search parameter in proxy mode', async () => {
      const events = [createTestEvent({ id: 'e1', name: 'Music Event' })]
      mockFetch.fetch.mockResolvedValue(createMockResponse(createEventsResponse(events)))

      const context = createContext('http://localhost/events?search=music')
      const response = await getEventsHandler(context as any)

      expect(response.status).toBe(200)
      expect(mockFetch.fetch).toHaveBeenCalledWith(
        'https://events.decentraland.org/api/events?search=music'
      )
    })

    it('should handle API returning ok: false', async () => {
      mockFetch.fetch.mockResolvedValue(
        createMockResponse({ ok: false, data: [], total: 0 })
      )

      const context = createContext('http://localhost/events')
      const response = await getEventsHandler(context as any)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ ok: false, data: [], total: 0 })
    })
  })

  describe('caching', () => {
    it('should return cached results when available in proxy mode', async () => {
      const cachedEvents = [createTestEvent({ id: 'cached-event' })]
      mockCache.get.mockImplementation(async (key: string) => {
        if (key === 'events:query:') {
          return ['events:id:cached-event']
        }
        if (key === 'events:id:cached-event') {
          return cachedEvents[0]
        }
        return null
      })

      const context = createContext('http://localhost/events')
      const response = await getEventsHandler(context as any)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ ok: true, data: cachedEvents, total: 1 })
      expect(mockFetch.fetch).not.toHaveBeenCalled()
    })

    it('should cache results after fetching in proxy mode', async () => {
      const events = [createTestEvent({ id: 'e1' })]
      mockFetch.fetch.mockResolvedValue(createMockResponse(createEventsResponse(events)))

      const context = createContext('http://localhost/events')
      await getEventsHandler(context as any)

      expect(mockCache.set).toHaveBeenCalledWith('events:id:e1', events[0], 7200000)
      expect(mockCache.set).toHaveBeenCalledWith('events:query:', ['events:id:e1'], 7200000)
    })

    it('should return cached results when available in tag mode', async () => {
      const places = [createTestPlace({ id: 'p1', basePosition: '5,5', positions: ['5,5'] })]
      const cachedEvents = [createTestEvent({ id: 'cached-tag-event' })]

      mockPlacesDb.getAllPlaces.mockResolvedValue(places)
      mockCache.get.mockImplementation(async (key: string) => {
        if (key === 'events:query:places:5,5::') {
          return ['events:id:cached-tag-event']
        }
        if (key === 'events:id:cached-tag-event') {
          return cachedEvents[0]
        }
        return null
      })

      const context = createContext('http://localhost/events?tag=featured')
      const response = await getEventsHandler(context as any)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ ok: true, data: cachedEvents, total: 1 })
      expect(mockFetch.fetch).not.toHaveBeenCalled()
    })
  })

  describe('error handling', () => {
    it('should return 500 when placesDb throws an error', async () => {
      mockPlacesDb.getAllPlaces.mockRejectedValue(new Error('Database error'))

      const context = createContext('http://localhost/events?tag=featured')
      const response = await getEventsHandler(context as any)

      expect(response.status).toBe(500)
      expect(response.body).toEqual({ ok: false, error: 'Internal server error' })
    })

    it('should return ok: false when fetch throws an error', async () => {
      mockFetch.fetch.mockRejectedValue(new Error('Network error'))

      const context = createContext('http://localhost/events')
      const response = await getEventsHandler(context as any)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ ok: false, data: [], total: 0 })
    })

    it('should log proxy errors', async () => {
      mockFetch.fetch.mockRejectedValue(new Error('Connection timeout'))

      const context = createContext('http://localhost/events')
      await getEventsHandler(context as any)

      const logger = mockLogs.getLogger('get-events')
      expect(logger.error).toHaveBeenCalledWith('Proxy error', { error: 'Connection timeout' })
    })

    it('should handle API error in tag mode', async () => {
      const places = [createTestPlace({ id: 'p1', basePosition: '0,0', positions: ['0,0'] })]

      mockPlacesDb.getAllPlaces.mockResolvedValue(places)
      mockFetch.fetch.mockResolvedValue(createMockResponse({}, false, 500))

      const context = createContext('http://localhost/events?tag=allowed_ios')
      const response = await getEventsHandler(context as any)

      expect(response.status).toBe(200)
      const body = response.body as EventsResponse
      expect(body.ok).toBe(false)
      expect(body.data).toEqual([])
    })
  })

  describe('configuration', () => {
    it('should use configured API URL', async () => {
      mockConfig = createConfigJestMockComponent({
        EVENTS_API_URL: 'https://custom-events.example.com/api',
        EVENTS_CACHE_TTL_MS: '3600000'
      })
      const events = [createTestEvent({ id: 'e1' })]
      mockFetch.fetch.mockResolvedValue(createMockResponse(createEventsResponse(events)))

      const context = createContext('http://localhost/events')
      context.components.config = mockConfig
      await getEventsHandler(context as any)

      expect(mockFetch.fetch).toHaveBeenCalledWith('https://custom-events.example.com/api')
    })

    it('should use default API URL when not configured', async () => {
      mockConfig = createConfigJestMockComponent({})
      const events = [createTestEvent({ id: 'e1' })]
      mockFetch.fetch.mockResolvedValue(createMockResponse(createEventsResponse(events)))

      const context = createContext('http://localhost/events')
      context.components.config = mockConfig
      await getEventsHandler(context as any)

      expect(mockFetch.fetch).toHaveBeenCalledWith('https://events.decentraland.org/api/events')
    })
  })
})
