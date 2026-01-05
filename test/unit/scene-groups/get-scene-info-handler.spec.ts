import { getSceneInfoHandler } from '../../../src/controllers/handlers/scene-groups/get-scene-info-handler'
import { createSceneGroupsDbJestMockComponent, createTestSceneGroup } from '../../mocks/scene-groups-db-mock'
import { createBansDbJestMockComponent, createTestGroupBan, createTestSceneBan } from '../../mocks/bans-db-mock'
import { createLogsMockComponent } from '../../mocks/logs-mock'

describe('get-scene-info-handler', () => {
  let mockSceneGroupsDb: ReturnType<typeof createSceneGroupsDbJestMockComponent>
  let mockBansDb: ReturnType<typeof createBansDbJestMockComponent>
  let mockLogs: ReturnType<typeof createLogsMockComponent>

  beforeEach(() => {
    mockSceneGroupsDb = createSceneGroupsDbJestMockComponent()
    mockBansDb = createBansDbJestMockComponent()
    mockLogs = createLogsMockComponent()
  })

  function createContext(queryString: string) {
    return {
      components: {
        sceneGroupsDb: mockSceneGroupsDb,
        bansDb: mockBansDb,
        logs: mockLogs
      },
      url: new URL(`http://localhost/scene-info${queryString}`)
    }
  }

  describe('when parcels parameter is missing', () => {
    it('should return 400 Bad Request', async () => {
      const context = createContext('')
      const response = await getSceneInfoHandler(context as any)

      expect(response.status).toBe(400)
      expect(response.body).toEqual({
        ok: false,
        error: 'Missing parcels parameter. Use parcels=x1,y1;x2,y2'
      })
    })
  })

  describe('when parcels format is invalid', () => {
    it('should return 400 for malformed parcel', async () => {
      const context = createContext('?parcels=invalid')
      const response = await getSceneInfoHandler(context as any)

      expect(response.status).toBe(400)
      expect(response.body.error).toContain('Invalid parcel format')
    })

    it('should return 400 for non-integer coordinates', async () => {
      const context = createContext('?parcels=abc,2')
      const response = await getSceneInfoHandler(context as any)

      expect(response.status).toBe(400)
      expect(response.body.error).toContain('Must be integers')
    })

    it('should return 400 for empty parcels', async () => {
      const context = createContext('?parcels=')
      const response = await getSceneInfoHandler(context as any)

      expect(response.status).toBe(400)
    })
  })

  describe('when parcel belongs to a scene group', () => {
    const testGroup = createTestSceneGroup({
      id: 'group-123',
      name: 'Test Group',
      parcels: [{ x: 10, y: 20 }, { x: 11, y: 20 }]
    })

    beforeEach(() => {
      mockSceneGroupsDb.getSceneGroupByParcel.mockResolvedValue(testGroup)
    })

    it('should return group info with isBanned=false when not banned', async () => {
      mockBansDb.getBanByGroupId.mockResolvedValue(null)

      const context = createContext('?parcels=10,20')
      const response = await getSceneInfoHandler(context as any)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({
        ok: true,
        data: {
          type: 'group',
          group: testGroup,
          isBanned: false
        }
      })
    })

    it('should return group info with isBanned=true when banned', async () => {
      mockBansDb.getBanByGroupId.mockResolvedValue(createTestGroupBan('group-123'))

      const context = createContext('?parcels=10,20')
      const response = await getSceneInfoHandler(context as any)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({
        ok: true,
        data: {
          type: 'group',
          group: testGroup,
          isBanned: true
        }
      })
    })

    it('should check group ban by group id', async () => {
      const context = createContext('?parcels=10,20')
      await getSceneInfoHandler(context as any)

      expect(mockBansDb.getBanByGroupId).toHaveBeenCalledWith('group-123')
    })
  })

  describe('when parcel is an isolated scene (no group)', () => {
    beforeEach(() => {
      mockSceneGroupsDb.getSceneGroupByParcel.mockResolvedValue(null)
    })

    it('should return scene info with isBanned=false when not banned', async () => {
      mockBansDb.getBanByParcels.mockResolvedValue(null)

      const context = createContext('?parcels=50,60;51,60')
      const response = await getSceneInfoHandler(context as any)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({
        ok: true,
        data: {
          type: 'scene',
          parcels: [{ x: 50, y: 60 }, { x: 51, y: 60 }],
          isBanned: false
        }
      })
    })

    it('should return scene info with isBanned=true when banned', async () => {
      const parcels = [{ x: 50, y: 60 }, { x: 51, y: 60 }]
      mockBansDb.getBanByParcels.mockResolvedValue(createTestSceneBan(parcels))

      const context = createContext('?parcels=50,60;51,60')
      const response = await getSceneInfoHandler(context as any)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({
        ok: true,
        data: {
          type: 'scene',
          parcels: parcels,
          isBanned: true
        }
      })
    })

    it('should check scene ban by parcels', async () => {
      const context = createContext('?parcels=50,60;51,60')
      await getSceneInfoHandler(context as any)

      expect(mockBansDb.getBanByParcels).toHaveBeenCalledWith([
        { x: 50, y: 60 },
        { x: 51, y: 60 }
      ])
    })

    it('should handle negative coordinates', async () => {
      mockBansDb.getBanByParcels.mockResolvedValue(null)

      const context = createContext('?parcels=-10,-20;-11,-20')
      const response = await getSceneInfoHandler(context as any)

      expect(response.status).toBe(200)
      expect(response.body.data.parcels).toEqual([
        { x: -10, y: -20 },
        { x: -11, y: -20 }
      ])
    })
  })

  describe('when database throws an error', () => {
    it('should return 500 Internal Server Error', async () => {
      mockSceneGroupsDb.getSceneGroupByParcel.mockRejectedValue(new Error('Database error'))

      const context = createContext('?parcels=0,0')
      const response = await getSceneInfoHandler(context as any)

      expect(response.status).toBe(500)
      expect(response.body).toEqual({ ok: false, error: 'Internal server error' })
    })

    it('should log the error', async () => {
      mockSceneGroupsDb.getSceneGroupByParcel.mockRejectedValue(new Error('Connection lost'))

      const context = createContext('?parcels=0,0')
      await getSceneInfoHandler(context as any)

      const logger = mockLogs.getLogger('get-scene-info')
      expect(logger.error).toHaveBeenCalledWith('Error fetching scene info', {
        error: 'Connection lost'
      })
    })
  })
})
