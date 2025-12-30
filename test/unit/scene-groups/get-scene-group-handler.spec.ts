import { getSceneGroupHandler } from '../../../src/controllers/handlers/scene-groups/get-scene-group-handler'
import { createSceneGroupsDbJestMockComponent, createTestSceneGroup } from '../../mocks/scene-groups-db-mock'
import { createLogsMockComponent } from '../../mocks/logs-mock'

describe('get-scene-group-handler', () => {
  let mockSceneGroupsDb: ReturnType<typeof createSceneGroupsDbJestMockComponent>
  let mockLogs: ReturnType<typeof createLogsMockComponent>

  beforeEach(() => {
    mockSceneGroupsDb = createSceneGroupsDbJestMockComponent()
    mockLogs = createLogsMockComponent()
  })

  function createContext(id: string) {
    return {
      components: {
        sceneGroupsDb: mockSceneGroupsDb,
        logs: mockLogs
      },
      params: { id }
    }
  }

  describe('when the scene group exists', () => {
    it('should return 200 with the scene group', async () => {
      const group = createTestSceneGroup({ id: 'test-id-123' })
      mockSceneGroupsDb.getSceneGroupById.mockResolvedValue(group)

      const context = createContext('test-id-123')
      const response = await getSceneGroupHandler(context as any)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ ok: true, data: group })
      expect(mockSceneGroupsDb.getSceneGroupById).toHaveBeenCalledWith('test-id-123')
    })
  })

  describe('when the scene group does not exist', () => {
    it('should return 404 Not Found', async () => {
      mockSceneGroupsDb.getSceneGroupById.mockResolvedValue(null)

      const context = createContext('non-existent-id')
      const response = await getSceneGroupHandler(context as any)

      expect(response.status).toBe(404)
      expect(response.body).toEqual({ ok: false, error: 'Scene group not found' })
    })
  })

  describe('when database throws an error', () => {
    it('should return 500 Internal Server Error', async () => {
      mockSceneGroupsDb.getSceneGroupById.mockRejectedValue(new Error('Database error'))

      const context = createContext('some-id')
      const response = await getSceneGroupHandler(context as any)

      expect(response.status).toBe(500)
      expect(response.body).toEqual({ ok: false, error: 'Internal server error' })
    })

    it('should log the error with the id', async () => {
      mockSceneGroupsDb.getSceneGroupById.mockRejectedValue(new Error('Database error'))

      const context = createContext('some-id')
      await getSceneGroupHandler(context as any)

      const logger = mockLogs.getLogger('get-scene-group')
      expect(logger.error).toHaveBeenCalledWith('Error fetching scene group', {
        error: 'Database error',
        id: 'some-id'
      })
    })
  })
})
