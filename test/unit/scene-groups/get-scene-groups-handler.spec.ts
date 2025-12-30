import { getSceneGroupsHandler } from '../../../src/controllers/handlers/scene-groups/get-scene-groups-handler'
import { createSceneGroupsDbJestMockComponent, createTestSceneGroup } from '../../mocks/scene-groups-db-mock'
import { createLogsMockComponent } from '../../mocks/logs-mock'

describe('get-scene-groups-handler', () => {
  let mockSceneGroupsDb: ReturnType<typeof createSceneGroupsDbJestMockComponent>
  let mockLogs: ReturnType<typeof createLogsMockComponent>

  beforeEach(() => {
    mockSceneGroupsDb = createSceneGroupsDbJestMockComponent()
    mockLogs = createLogsMockComponent()
  })

  function createContext(queryParams: Record<string, string> = {}) {
    const searchParams = new URLSearchParams(queryParams)
    const url = `http://localhost/scene-groups${searchParams.toString() ? '?' + searchParams.toString() : ''}`
    return {
      components: {
        sceneGroupsDb: mockSceneGroupsDb,
        logs: mockLogs
      },
      url: new URL(url)
    }
  }

  describe('when fetching all scene groups', () => {
    it('should return 200 with empty array when no groups exist', async () => {
      const context = createContext()

      const response = await getSceneGroupsHandler(context as any)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ ok: true, data: [] })
    })

    it('should return 200 with all scene groups', async () => {
      const groups = [
        createTestSceneGroup({ id: '1', name: 'Group 1' }),
        createTestSceneGroup({ id: '2', name: 'Group 2' })
      ]
      mockSceneGroupsDb.getAllSceneGroups.mockResolvedValue(groups)

      const context = createContext()
      const response = await getSceneGroupsHandler(context as any)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ ok: true, data: groups })
      expect(mockSceneGroupsDb.getAllSceneGroups).toHaveBeenCalled()
    })
  })

  describe('when filtering by parcel coordinates', () => {
    it('should return 200 with the scene group containing the parcel', async () => {
      const group = createTestSceneGroup({ id: '1', name: 'Group at 0,0' })
      mockSceneGroupsDb.getSceneGroupByParcel.mockResolvedValue(group)

      const context = createContext({ parcel: '0,0' })
      const response = await getSceneGroupsHandler(context as any)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ ok: true, data: group })
      expect(mockSceneGroupsDb.getSceneGroupByParcel).toHaveBeenCalledWith(0, 0)
    })

    it('should return 200 with null when no group contains the parcel', async () => {
      mockSceneGroupsDb.getSceneGroupByParcel.mockResolvedValue(null)

      const context = createContext({ parcel: '100,100' })
      const response = await getSceneGroupsHandler(context as any)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ ok: true, data: null })
    })

    it('should return 400 when parcel coordinates are not valid integers', async () => {
      const context = createContext({ parcel: 'abc,0' })
      const response = await getSceneGroupsHandler(context as any)

      expect(response.status).toBe(400)
      expect(response.body).toEqual({ ok: false, error: 'Invalid parcel coordinates. Must be integers.' })
    })

    it('should return 400 when parcel format is invalid', async () => {
      const context = createContext({ parcel: '0' })
      const response = await getSceneGroupsHandler(context as any)

      expect(response.status).toBe(400)
      expect(response.body).toEqual({ ok: false, error: 'Invalid parcel format. Use parcel=x,y (e.g., parcel=0,1)' })
    })

    it('should handle negative coordinates', async () => {
      const group = createTestSceneGroup({ id: '1', parcels: [{ x: -10, y: -20 }] })
      mockSceneGroupsDb.getSceneGroupByParcel.mockResolvedValue(group)

      const context = createContext({ parcel: '-10,-20' })
      const response = await getSceneGroupsHandler(context as any)

      expect(response.status).toBe(200)
      expect(mockSceneGroupsDb.getSceneGroupByParcel).toHaveBeenCalledWith(-10, -20)
    })
  })

  describe('when database throws an error', () => {
    it('should return 500 Internal Server Error', async () => {
      mockSceneGroupsDb.getAllSceneGroups.mockRejectedValue(new Error('Database error'))

      const context = createContext()
      const response = await getSceneGroupsHandler(context as any)

      expect(response.status).toBe(500)
      expect(response.body).toEqual({ ok: false, error: 'Internal server error' })
    })

    it('should log the error', async () => {
      mockSceneGroupsDb.getAllSceneGroups.mockRejectedValue(new Error('Database error'))

      const context = createContext()
      await getSceneGroupsHandler(context as any)

      const logger = mockLogs.getLogger('get-scene-groups')
      expect(logger.error).toHaveBeenCalledWith('Error fetching scene groups', { error: 'Database error' })
    })
  })
})
