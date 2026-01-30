import { getBansHandler } from '../../../src/controllers/handlers/bans/get-bans-handler'
import { createBansDbJestMockComponent, createTestBan, createTestGroupBan, createTestSceneBan } from '../../mocks/bans-db-mock'
import { createLogsMockComponent } from '../../mocks/logs-mock'

describe('get-bans-handler (public)', () => {
  let mockBansDb: ReturnType<typeof createBansDbJestMockComponent>
  let mockLogs: ReturnType<typeof createLogsMockComponent>

  beforeEach(() => {
    mockBansDb = createBansDbJestMockComponent()
    mockLogs = createLogsMockComponent()
  })

  function createContext() {
    return {
      components: {
        bansDb: mockBansDb,
        logs: mockLogs
      },
      url: new URL('http://localhost/bans')
    }
  }

  describe('when there are no bans', () => {
    it('should return empty array', async () => {
      mockBansDb.getAllBans.mockResolvedValue([])

      const context = createContext()
      const response = await getBansHandler(context as any)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({
        ok: true,
        data: []
      })
    })
  })

  describe('when there are bans', () => {
    it('should return all bans', async () => {
      const sceneBan = createTestSceneBan(['10,20'], { id: 'ban-1' })
      const groupBan = createTestGroupBan('group-123', { id: 'ban-2' })
      const worldBan = createTestBan({ id: 'ban-3', worldName: 'cool-world.dcl.eth', positions: [] })

      mockBansDb.getAllBans.mockResolvedValue([sceneBan, groupBan, worldBan])

      const context = createContext()
      const response = await getBansHandler(context as any)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({
        ok: true,
        data: [sceneBan, groupBan, worldBan]
      })
    })

    it('should include all ban types', async () => {
      const bans = [
        createTestSceneBan(['0,0', '1,0'], { id: 'scene-ban', sceneId: 'bafk123' }),
        createTestGroupBan('group-456', { id: 'group-ban', reason: 'Inappropriate content' }),
        createTestBan({ id: 'world-ban', worldName: 'my-world.dcl.eth', positions: [], sceneId: 'world-scene-123' })
      ]

      mockBansDb.getAllBans.mockResolvedValue(bans)

      const context = createContext()
      const response = await getBansHandler(context as any)

      expect(response.status).toBe(200)
      expect(response.body.data).toHaveLength(3)
      expect(response.body.data[0].positions).toEqual(['0,0', '1,0'])
      expect(response.body.data[1].groupId).toBe('group-456')
      expect(response.body.data[2].worldName).toBe('my-world.dcl.eth')
    })
  })

  describe('when database throws an error', () => {
    it('should return 500 Internal Server Error', async () => {
      mockBansDb.getAllBans.mockRejectedValue(new Error('Database connection failed'))

      const context = createContext()
      const response = await getBansHandler(context as any)

      expect(response.status).toBe(500)
      expect(response.body).toEqual({ ok: false, error: 'Internal server error' })
    })

    it('should log the error', async () => {
      mockBansDb.getAllBans.mockRejectedValue(new Error('Connection timeout'))

      const context = createContext()
      await getBansHandler(context as any)

      const logger = mockLogs.getLogger('get-bans')
      expect(logger.error).toHaveBeenCalledWith('Error fetching bans', {
        error: 'Connection timeout'
      })
    })
  })
})
