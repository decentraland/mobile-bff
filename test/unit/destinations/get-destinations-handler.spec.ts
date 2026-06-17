import { getDestinationsHandler } from '../../../src/controllers/handlers/destinations/get-destinations-handler'
import { createPlacesDbMockComponent, createTestPlace, createTestWorldPlace } from '../../mocks/places-db-mock'
import { createDestinationsApiMockComponent, createTestDestination, createTestWorldDestination, createDestinationsResponse } from '../../mocks/destinations-api-mock'
import { createLogsMockComponent } from '../../mocks/logs-mock'

describe('get-destinations-handler', () => {
  let mockPlacesDb: ReturnType<typeof createPlacesDbMockComponent>
  let mockDestinationsApi: ReturnType<typeof createDestinationsApiMockComponent>
  let mockLogs: ReturnType<typeof createLogsMockComponent>

  beforeEach(() => {
    mockPlacesDb = createPlacesDbMockComponent()
    mockDestinationsApi = createDestinationsApiMockComponent()
    mockLogs = createLogsMockComponent()
  })

  function createContext(url: string, headers: Record<string, string> = {}) {
    const headersMap = new Map(Object.entries(headers))
    return {
      components: {
        placesDb: mockPlacesDb,
        destinationsApi: mockDestinationsApi,
        logs: mockLogs
      },
      url: new URL(url),
      request: {
        headers: {
          forEach: (callback: (value: string, key: string) => void) => {
            headersMap.forEach((value, key) => callback(value, key))
          }
        }
      }
    }
  }

  describe('tag mode (with ?tag=)', () => {
    describe('when tag parameter is valid', () => {
      it('should query places by tag and return destinations', async () => {
        const places = [
          createTestPlace({ id: 'p1', basePosition: '0,0' }),
          createTestPlace({ id: 'p2', basePosition: '10,20' })
        ]
        const destinations = [
          createTestDestination({ id: 'd1', base_position: '0,0' }),
          createTestDestination({ id: 'd2', base_position: '10,20' })
        ]

        mockPlacesDb.getAllPlaces.mockResolvedValue(places)
        mockDestinationsApi.getForPlaces.mockResolvedValue(createDestinationsResponse(destinations))

        const context = createContext('http://localhost/destinations?tag=allowed_ios')
        const response = await getDestinationsHandler(context as any)

        expect(response.status).toBe(200)
        expect(response.body).toEqual({ ok: true, data: destinations, total: destinations.length })
        expect(mockPlacesDb.getAllPlaces).toHaveBeenCalledWith(['allowed_ios'])
        expect(mockDestinationsApi.getForPlaces).toHaveBeenCalledWith(places, '', {})
      })

      it('should handle multiple comma-separated tags', async () => {
        mockPlacesDb.getAllPlaces.mockResolvedValue([])
        mockDestinationsApi.getForPlaces.mockResolvedValue(createDestinationsResponse([]))

        const context = createContext('http://localhost/destinations?tag=allowed_ios,featured')
        const response = await getDestinationsHandler(context as any)

        expect(response.status).toBe(200)
        expect(mockPlacesDb.getAllPlaces).toHaveBeenCalledWith(['allowed_ios', 'featured'])
      })

      it('should trim whitespace from tags', async () => {
        mockPlacesDb.getAllPlaces.mockResolvedValue([])
        mockDestinationsApi.getForPlaces.mockResolvedValue(createDestinationsResponse([]))

        const context = createContext('http://localhost/destinations?tag=%20allowed_ios%20,%20featured%20')
        const response = await getDestinationsHandler(context as any)

        expect(response.status).toBe(200)
        expect(mockPlacesDb.getAllPlaces).toHaveBeenCalledWith(['allowed_ios', 'featured'])
      })

      it('should return empty array when no places match the tag', async () => {
        mockPlacesDb.getAllPlaces.mockResolvedValue([])
        mockDestinationsApi.getForPlaces.mockResolvedValue(createDestinationsResponse([]))

        const context = createContext('http://localhost/destinations?tag=nonexistent_tag')
        const response = await getDestinationsHandler(context as any)

        expect(response.status).toBe(200)
        expect(response.body).toEqual({ ok: true, data: [], total: 0 })
      })

      it('should handle world places', async () => {
        const places = [createTestWorldPlace({ worldName: 'cool-world.dcl.eth' })]
        const destinations = [createTestWorldDestination({ world_name: 'cool-world.dcl.eth' })]

        mockPlacesDb.getAllPlaces.mockResolvedValue(places)
        mockDestinationsApi.getForPlaces.mockResolvedValue(createDestinationsResponse(destinations))

        const context = createContext('http://localhost/destinations?tag=featured')
        const response = await getDestinationsHandler(context as any)

        expect(response.status).toBe(200)
        const body = response.body as { ok: boolean; data: any[]; total: number }
        expect(body.data).toHaveLength(1)
        expect(body.data[0].world_name).toBe('cool-world.dcl.eth')
      })

      it('should pass additional query params to getForPlaces with tag', async () => {
        const places = [createTestPlace({ id: 'p1', basePosition: '0,0' })]
        const destinations = [createTestDestination({ id: 'd1', base_position: '0,0' })]

        mockPlacesDb.getAllPlaces.mockResolvedValue(places)
        mockDestinationsApi.getForPlaces.mockResolvedValue(createDestinationsResponse(destinations))

        const context = createContext('http://localhost/destinations?tag=allowed_ios&search=museum&limit=10')
        const response = await getDestinationsHandler(context as any)

        expect(response.status).toBe(200)
        expect(mockPlacesDb.getAllPlaces).toHaveBeenCalledWith(['allowed_ios'])
        expect(mockDestinationsApi.getForPlaces).toHaveBeenCalledWith(places, 'search=museum&limit=10', {})
      })

      it('should pass order_by and other filters with tag', async () => {
        const places = [createTestPlace({ id: 'p1', basePosition: '5,5' })]

        mockPlacesDb.getAllPlaces.mockResolvedValue(places)
        mockDestinationsApi.getForPlaces.mockResolvedValue(createDestinationsResponse([]))

        const context = createContext('http://localhost/destinations?tag=featured&order_by=like_score&limit=5&offset=10')
        const response = await getDestinationsHandler(context as any)

        expect(response.status).toBe(200)
        expect(mockDestinationsApi.getForPlaces).toHaveBeenCalledWith(places, 'order_by=like_score&limit=5&offset=10', {})
      })
    })

    describe('when tag parameter is empty', () => {
      it('should fall through to proxy mode for empty tag parameter', async () => {
        mockDestinationsApi.proxyQuery.mockResolvedValue(createDestinationsResponse([]))

        const context = createContext('http://localhost/destinations?tag=')
        const response = await getDestinationsHandler(context as any)

        expect(response.status).toBe(200)
        expect(mockDestinationsApi.proxyQuery).toHaveBeenCalledWith('', {})
      })

      it('should return 400 for whitespace-only tag parameter', async () => {
        const context = createContext('http://localhost/destinations?tag=%20%20')
        const response = await getDestinationsHandler(context as any)

        expect(response.status).toBe(400)
        expect(response.body).toEqual({ ok: false, error: 'Invalid tag parameter' })
      })
    })
  })

  describe('proxy mode (no tag parameter)', () => {
    it('should proxy request to destinations API', async () => {
      const destinations = [
        createTestDestination({ id: 'd1' }),
        createTestDestination({ id: 'd2' })
      ]
      mockDestinationsApi.proxyQuery.mockResolvedValue(createDestinationsResponse(destinations))

      const context = createContext('http://localhost/destinations?limit=10&order_by=like_score')
      const response = await getDestinationsHandler(context as any)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ ok: true, data: destinations, total: 2 })
      expect(mockDestinationsApi.proxyQuery).toHaveBeenCalledWith('limit=10&order_by=like_score', {})
    })

    it('should call proxyQuery with empty string when no query params', async () => {
      mockDestinationsApi.proxyQuery.mockResolvedValue(createDestinationsResponse([]))

      const context = createContext('http://localhost/destinations')
      const response = await getDestinationsHandler(context as any)

      expect(response.status).toBe(200)
      expect(mockDestinationsApi.proxyQuery).toHaveBeenCalledWith('', {})
    })

    it('should handle API returning ok: false', async () => {
      mockDestinationsApi.proxyQuery.mockResolvedValue({ ok: false, data: [], total: 0 })

      const context = createContext('http://localhost/destinations')
      const response = await getDestinationsHandler(context as any)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ ok: false, data: [], total: 0 })
    })
  })

  // TEMP workaround (decentraland/godot-explorer#1827): for order_by=most_active
  // we fetch the full candidate window upstream, re-rank by user_count desc, drop
  // empty scenes, then slice to the requested page locally.
  // EXCEPTION: when search is present, we sort but DON'T filter out 0-user results.
  describe('most_active re-ranking', () => {
    it('should fetch the full window upstream (offset=0, limit=100) regardless of client paging', async () => {
      mockDestinationsApi.proxyQuery.mockResolvedValue(createDestinationsResponse([]))

      const context = createContext('http://localhost/destinations?limit=5&offset=10&order_by=most_active')
      await getDestinationsHandler(context as any)

      expect(mockDestinationsApi.proxyQuery).toHaveBeenCalledWith('limit=100&offset=0&order_by=most_active', {})
    })

    it('should rank by user_count desc and drop scenes with 0 users', async () => {
      const destinations = [
        createTestDestination({ id: 'low', base_position: '1,1', user_count: 2 }),
        createTestDestination({ id: 'empty', base_position: '2,2', user_count: 0 }),
        createTestDestination({ id: 'high', base_position: '3,3', user_count: 9 }),
        createTestDestination({ id: 'none', base_position: '4,4' })
      ]
      mockDestinationsApi.proxyQuery.mockResolvedValue(createDestinationsResponse(destinations))

      const context = createContext('http://localhost/destinations?order_by=most_active')
      const response = await getDestinationsHandler(context as any)

      expect(response.status).toBe(200)
      const body = response.body as { ok: boolean; data: any[]; total: number }
      expect(body.total).toBe(2)
      expect(body.data.map((d) => d.id)).toEqual(['high', 'low'])
    })

    it('should slice the ranked results to the requested page', async () => {
      const destinations = [
        createTestDestination({ id: 'a', base_position: '1,1', user_count: 5 }),
        createTestDestination({ id: 'b', base_position: '2,2', user_count: 4 }),
        createTestDestination({ id: 'c', base_position: '3,3', user_count: 3 })
      ]
      mockDestinationsApi.proxyQuery.mockResolvedValue(createDestinationsResponse(destinations))

      const context = createContext('http://localhost/destinations?order_by=most_active&limit=1&offset=1')
      const response = await getDestinationsHandler(context as any)

      expect(response.status).toBe(200)
      const body = response.body as { ok: boolean; data: any[]; total: number }
      // total reflects the full ranked set; data is the requested slice
      expect(body.total).toBe(3)
      expect(body.data.map((d) => d.id)).toEqual(['b'])
    })

    it('should re-rank tag-mode results too', async () => {
      const places = [createTestPlace({ id: 'p1', basePosition: '1,1' })]
      const destinations = [
        createTestDestination({ id: 'low', base_position: '1,1', user_count: 1 }),
        createTestDestination({ id: 'empty', base_position: '2,2', user_count: 0 }),
        createTestDestination({ id: 'high', base_position: '3,3', user_count: 7 })
      ]
      mockPlacesDb.getAllPlaces.mockResolvedValue(places)
      mockDestinationsApi.getForPlaces.mockResolvedValue(createDestinationsResponse(destinations))

      const context = createContext('http://localhost/destinations?tag=featured&order_by=most_active')
      const response = await getDestinationsHandler(context as any)

      expect(response.status).toBe(200)
      const body = response.body as { ok: boolean; data: any[]; total: number }
      expect(body.total).toBe(2)
      expect(body.data.map((d) => d.id)).toEqual(['high', 'low'])
      // upstream still receives the widened window
      expect(mockDestinationsApi.getForPlaces).toHaveBeenCalledWith(places, 'order_by=most_active&offset=0&limit=100', {})
    })

    it('should NOT filter out 0-user results when search is present', async () => {
      const destinations = [
        createTestDestination({ id: 'museum-low', base_position: '1,1', user_count: 2, title: 'Museum A' }),
        createTestDestination({ id: 'museum-empty', base_position: '2,2', user_count: 0, title: 'Museum B' }),
        createTestDestination({ id: 'museum-high', base_position: '3,3', user_count: 9, title: 'Museum C' })
      ]
      mockDestinationsApi.proxyQuery.mockResolvedValue(createDestinationsResponse(destinations))

      const context = createContext('http://localhost/destinations?order_by=most_active&search=museum')
      const response = await getDestinationsHandler(context as any)

      expect(response.status).toBe(200)
      const body = response.body as { ok: boolean; data: any[]; total: number }
      // Should include ALL search results (including 0-user)
      expect(body.total).toBe(3)
      // Should be sorted by user_count desc
      expect(body.data.map((d) => d.id)).toEqual(['museum-high', 'museum-low', 'museum-empty'])
      // Should have removed order_by from upstream request (to avoid foundation filtering)
      expect(mockDestinationsApi.proxyQuery).toHaveBeenCalledWith('search=museum', {})
    })

    it('should sort by user_count when search + most_active are both present (tag mode)', async () => {
      const places = [createTestPlace({ id: 'p1', basePosition: '1,1' })]
      const destinations = [
        createTestDestination({ id: 'empty', base_position: '1,1', user_count: 0, title: 'Empty Place' }),
        createTestDestination({ id: 'busy', base_position: '2,2', user_count: 5, title: 'Busy Place' })
      ]
      mockPlacesDb.getAllPlaces.mockResolvedValue(places)
      mockDestinationsApi.getForPlaces.mockResolvedValue(createDestinationsResponse(destinations))

      const context = createContext('http://localhost/destinations?tag=allowed_ios&search=place&order_by=most_active')
      const response = await getDestinationsHandler(context as any)

      expect(response.status).toBe(200)
      const body = response.body as { ok: boolean; data: any[]; total: number }
      expect(body.total).toBe(2)
      expect(body.data.map((d) => d.id)).toEqual(['busy', 'empty'])
      // Should NOT pass order_by to upstream when search is present
      expect(mockDestinationsApi.getForPlaces).toHaveBeenCalledWith(places, 'search=place', {})
    })
  })

  describe('signed fetch header forwarding', () => {
    it('should forward x-identity-* headers to getForPlaces', async () => {
      const places = [createTestPlace({ id: 'p1', basePosition: '0,0' })]
      mockPlacesDb.getAllPlaces.mockResolvedValue(places)
      mockDestinationsApi.getForPlaces.mockResolvedValue(createDestinationsResponse([]))

      const context = createContext('http://localhost/destinations?tag=featured', {
        'x-identity-auth-chain-0': 'auth-chain-value-0',
        'x-identity-auth-chain-1': 'auth-chain-value-1',
        'x-identity-timestamp': '1234567890',
        'x-identity-metadata': 'metadata-value',
        'content-type': 'application/json' // should be ignored
      })
      await getDestinationsHandler(context as any)

      expect(mockDestinationsApi.getForPlaces).toHaveBeenCalledWith(
        places,
        '',
        {
          'x-identity-auth-chain-0': 'auth-chain-value-0',
          'x-identity-auth-chain-1': 'auth-chain-value-1',
          'x-identity-timestamp': '1234567890',
          'x-identity-metadata': 'metadata-value'
        }
      )
    })

    it('should forward x-identity-* headers to proxyQuery', async () => {
      mockDestinationsApi.proxyQuery.mockResolvedValue(createDestinationsResponse([]))

      const context = createContext('http://localhost/destinations', {
        'x-identity-auth-chain-0': 'auth-value',
        'authorization': 'Bearer token' // should be ignored
      })
      await getDestinationsHandler(context as any)

      expect(mockDestinationsApi.proxyQuery).toHaveBeenCalledWith(
        '',
        { 'x-identity-auth-chain-0': 'auth-value' }
      )
    })

    it('should normalize header names to lowercase', async () => {
      mockDestinationsApi.proxyQuery.mockResolvedValue(createDestinationsResponse([]))

      const context = createContext('http://localhost/destinations', {
        'X-Identity-Auth-Chain-0': 'auth-value'
      })
      await getDestinationsHandler(context as any)

      expect(mockDestinationsApi.proxyQuery).toHaveBeenCalledWith(
        '',
        { 'x-identity-auth-chain-0': 'auth-value' }
      )
    })
  })

  describe('error handling', () => {
    it('should return 500 when placesDb throws an error', async () => {
      mockPlacesDb.getAllPlaces.mockRejectedValue(new Error('Database error'))

      const context = createContext('http://localhost/destinations?tag=featured')
      const response = await getDestinationsHandler(context as any)

      expect(response.status).toBe(500)
      expect(response.body).toEqual({ ok: false, error: 'Internal server error' })
    })

    it('should return 500 when destinationsApi throws an error', async () => {
      mockDestinationsApi.proxyQuery.mockRejectedValue(new Error('Network error'))

      const context = createContext('http://localhost/destinations')
      const response = await getDestinationsHandler(context as any)

      expect(response.status).toBe(500)
      expect(response.body).toEqual({ ok: false, error: 'Internal server error' })
    })

    it('should log errors', async () => {
      mockDestinationsApi.proxyQuery.mockRejectedValue(new Error('Connection timeout'))

      const context = createContext('http://localhost/destinations')
      await getDestinationsHandler(context as any)

      const logger = mockLogs.getLogger('get-destinations')
      expect(logger.error).toHaveBeenCalledWith('Error', { error: 'Connection timeout' })
    })
  })
})
