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

  function createContext(url: string) {
    return {
      components: {
        placesDb: mockPlacesDb,
        destinationsApi: mockDestinationsApi,
        logs: mockLogs
      },
      url: new URL(url)
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
        expect(mockDestinationsApi.getForPlaces).toHaveBeenCalledWith(places, '')
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
        expect(mockDestinationsApi.getForPlaces).toHaveBeenCalledWith(places, 'search=museum&limit=10')
      })

      it('should pass order_by and other filters with tag', async () => {
        const places = [createTestPlace({ id: 'p1', basePosition: '5,5' })]

        mockPlacesDb.getAllPlaces.mockResolvedValue(places)
        mockDestinationsApi.getForPlaces.mockResolvedValue(createDestinationsResponse([]))

        const context = createContext('http://localhost/destinations?tag=featured&order_by=most_active&limit=5&offset=10')
        const response = await getDestinationsHandler(context as any)

        expect(response.status).toBe(200)
        expect(mockDestinationsApi.getForPlaces).toHaveBeenCalledWith(places, 'order_by=most_active&limit=5&offset=10')
      })
    })

    describe('when tag parameter is empty', () => {
      it('should fall through to proxy mode for empty tag parameter', async () => {
        mockDestinationsApi.proxyQuery.mockResolvedValue(createDestinationsResponse([]))

        const context = createContext('http://localhost/destinations?tag=')
        const response = await getDestinationsHandler(context as any)

        expect(response.status).toBe(200)
        expect(mockDestinationsApi.proxyQuery).toHaveBeenCalledWith('')
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

      const context = createContext('http://localhost/destinations?limit=10&order_by=most_active')
      const response = await getDestinationsHandler(context as any)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ ok: true, data: destinations, total: 2 })
      expect(mockDestinationsApi.proxyQuery).toHaveBeenCalledWith('limit=10&order_by=most_active')
    })

    it('should call proxyQuery with empty string when no query params', async () => {
      mockDestinationsApi.proxyQuery.mockResolvedValue(createDestinationsResponse([]))

      const context = createContext('http://localhost/destinations')
      const response = await getDestinationsHandler(context as any)

      expect(response.status).toBe(200)
      expect(mockDestinationsApi.proxyQuery).toHaveBeenCalledWith('')
    })

    it('should handle API returning ok: false', async () => {
      mockDestinationsApi.proxyQuery.mockResolvedValue({ ok: false, data: [], total: 0 })

      const context = createContext('http://localhost/destinations')
      const response = await getDestinationsHandler(context as any)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ ok: false, data: [], total: 0 })
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
