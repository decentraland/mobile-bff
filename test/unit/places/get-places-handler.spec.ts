import { getPlacesHandler } from '../../../src/controllers/handlers/places/get-places-handler'
import { createSceneGroupsDbJestMockComponent, createTestSceneGroup } from '../../mocks/scene-groups-db-mock'
import { createBansDbJestMockComponent, createTestGroupBan, createTestSceneBan } from '../../mocks/bans-db-mock'
import { createLogsMockComponent } from '../../mocks/logs-mock'

describe('get-places-handler', () => {
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
      url: new URL(`http://localhost/places${queryString}`)
    }
  }

  describe('when no query parameter is provided', () => {
    it('should return 400 Bad Request', async () => {
      const context = createContext('')
      const response = await getPlacesHandler(context as any)

      expect(response.status).toBe(400)
      expect(response.body).toEqual({
        ok: false,
        error: 'Missing query parameter. Use world=name, tag=tag1,tag2, or parcel=x,y'
      })
    })
  })

  describe('world query (?world=name)', () => {
    const testWorldGroup = createTestSceneGroup({
      id: 'world-group-123',
      name: 'test-world.dcl.eth',
      worldName: 'test-world.dcl.eth',
      parcels: []
    })

    it('should return world group when found', async () => {
      mockSceneGroupsDb.getSceneGroupByWorldName.mockResolvedValue(testWorldGroup)
      mockBansDb.getBanByGroupId.mockResolvedValue(null)

      const context = createContext('?world=test-world.dcl.eth')
      const response = await getPlacesHandler(context as any)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({
        ok: true,
        data: {
          type: 'world',
          group: testWorldGroup,
          isBanned: false,
          banSceneId: null
        }
      })
    })

    it('should return null when world not found', async () => {
      mockSceneGroupsDb.getSceneGroupByWorldName.mockResolvedValue(null)

      const context = createContext('?world=nonexistent.dcl.eth')
      const response = await getPlacesHandler(context as any)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({
        ok: true,
        data: null
      })
    })

    it('should return isBanned=true when world is banned', async () => {
      mockSceneGroupsDb.getSceneGroupByWorldName.mockResolvedValue(testWorldGroup)
      mockBansDb.getBanByGroupId.mockResolvedValue(createTestGroupBan('world-group-123'))

      const context = createContext('?world=test-world.dcl.eth')
      const response = await getPlacesHandler(context as any)

      expect(response.status).toBe(200)
      expect((response.body.data as any).isBanned).toBe(true)
    })

    it('should call getSceneGroupByWorldName with correct parameter', async () => {
      const context = createContext('?world=my-world.dcl.eth')
      await getPlacesHandler(context as any)

      expect(mockSceneGroupsDb.getSceneGroupByWorldName).toHaveBeenCalledWith('my-world.dcl.eth')
    })
  })

  describe('tag query (?tag=tag1,tag2)', () => {
    const testGroups = [
      createTestSceneGroup({ id: 'group-1', name: 'Group 1', tags: ['featured', 'allowed_ios'] }),
      createTestSceneGroup({ id: 'group-2', name: 'Group 2', tags: ['featured', 'allowed_ios'], worldName: 'world.dcl.eth' })
    ]

    it('should return groups matching tags', async () => {
      mockSceneGroupsDb.getAllSceneGroups.mockResolvedValue(testGroups)
      mockBansDb.getBanByGroupId.mockResolvedValue(null)

      const context = createContext('?tag=featured,allowed_ios')
      const response = await getPlacesHandler(context as any)

      expect(response.status).toBe(200)
      expect(response.body.ok).toBe(true)
      expect(response.body.data).toHaveLength(2)
      expect(response.body.data[0].type).toBe('group')
      expect(response.body.data[1].type).toBe('world')
    })

    it('should call getAllSceneGroups with tag filters', async () => {
      mockSceneGroupsDb.getAllSceneGroups.mockResolvedValue([])

      const context = createContext('?tag=featured,allowed_ios')
      await getPlacesHandler(context as any)

      expect(mockSceneGroupsDb.getAllSceneGroups).toHaveBeenCalledWith(['featured', 'allowed_ios'])
    })

    it('should return 400 for empty tag parameter', async () => {
      const context = createContext('?tag=')
      const response = await getPlacesHandler(context as any)

      expect(response.status).toBe(400)
      expect(response.body.error).toContain('Invalid tag parameter: empty value')
    })

    it('should include ban status for each group', async () => {
      mockSceneGroupsDb.getAllSceneGroups.mockResolvedValue([testGroups[0]])
      mockBansDb.getBanByGroupId.mockResolvedValue(createTestGroupBan('group-1'))

      const context = createContext('?tag=featured')
      const response = await getPlacesHandler(context as any)

      expect(response.body.data[0].isBanned).toBe(true)
    })
  })

  describe('parcel query (?parcel=x,y)', () => {
    const testGroup = createTestSceneGroup({
      id: 'parcel-group-123',
      name: 'Parcel Group',
      parcels: [{ x: 10, y: 20 }, { x: 11, y: 20 }]
    })

    describe('when parcel belongs to a group', () => {
      beforeEach(() => {
        mockSceneGroupsDb.getSceneGroupByParcel.mockResolvedValue(testGroup)
      })

      it('should return group info', async () => {
        mockBansDb.getBanByGroupId.mockResolvedValue(null)

        const context = createContext('?parcel=10,20')
        const response = await getPlacesHandler(context as any)

        expect(response.status).toBe(200)
        expect(response.body).toEqual({
          ok: true,
          data: {
            type: 'group',
            group: testGroup,
            isBanned: false,
            banSceneId: null
          }
        })
      })

      it('should return isBanned=true when group is banned', async () => {
        mockBansDb.getBanByGroupId.mockResolvedValue(createTestGroupBan('parcel-group-123'))

        const context = createContext('?parcel=10,20')
        const response = await getPlacesHandler(context as any)

        expect((response.body.data as any).isBanned).toBe(true)
      })
    })

    describe('when parcel is an isolated scene', () => {
      beforeEach(() => {
        mockSceneGroupsDb.getSceneGroupByParcel.mockResolvedValue(null)
      })

      it('should return scene info when not banned', async () => {
        mockBansDb.getBanByParcel.mockResolvedValue(null)

        const context = createContext('?parcel=50,60')
        const response = await getPlacesHandler(context as any)

        expect(response.status).toBe(200)
        expect(response.body).toEqual({
          ok: true,
          data: {
            type: 'scene',
            parcel: { x: 50, y: 60 },
            parcels: [{ x: 50, y: 60 }],
            isBanned: false,
            banSceneId: null
          }
        })
      })

      it('should return scene info with ban parcels when banned', async () => {
        const parcels = [{ x: 50, y: 60 }, { x: 51, y: 60 }]
        mockBansDb.getBanByParcel.mockResolvedValue(createTestSceneBan(parcels))

        const context = createContext('?parcel=50,60')
        const response = await getPlacesHandler(context as any)

        const data = response.body.data as any
        expect(data.type).toBe('scene')
        expect(data.parcels).toEqual(parcels)
        expect(data.isBanned).toBe(true)
      })
    })

    describe('validation', () => {
      it('should return 400 for invalid parcel format', async () => {
        const context = createContext('?parcel=invalid')
        const response = await getPlacesHandler(context as any)

        expect(response.status).toBe(400)
        expect(response.body.error).toContain('Invalid parcel format')
      })

      it('should return 400 for non-integer coordinates', async () => {
        const context = createContext('?parcel=abc,2')
        const response = await getPlacesHandler(context as any)

        expect(response.status).toBe(400)
        expect(response.body.error).toContain('Must be integers')
      })

      it('should handle negative coordinates', async () => {
        mockSceneGroupsDb.getSceneGroupByParcel.mockResolvedValue(null)
        mockBansDb.getBanByParcel.mockResolvedValue(null)

        const context = createContext('?parcel=-10,-20')
        const response = await getPlacesHandler(context as any)

        expect(response.status).toBe(200)
        expect((response.body.data as any).parcel).toEqual({ x: -10, y: -20 })
      })
    })
  })

  describe('error handling', () => {
    it('should return 500 when database throws an error', async () => {
      mockSceneGroupsDb.getSceneGroupByWorldName.mockRejectedValue(new Error('Database error'))

      const context = createContext('?world=test.dcl.eth')
      const response = await getPlacesHandler(context as any)

      expect(response.status).toBe(500)
      expect(response.body).toEqual({ ok: false, error: 'Internal server error' })
    })

    it('should log the error', async () => {
      mockSceneGroupsDb.getAllSceneGroups.mockRejectedValue(new Error('Connection lost'))

      const context = createContext('?tag=test')
      await getPlacesHandler(context as any)

      const logger = mockLogs.getLogger('get-places')
      expect(logger.error).toHaveBeenCalledWith('Error fetching places', {
        error: 'Connection lost'
      })
    })
  })
})
