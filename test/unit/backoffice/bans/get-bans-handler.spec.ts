import { getBansHandler } from '../../../../src/controllers/handlers/backoffice/bans/get-bans-handler'
import { createBansDbJestMockComponent, createTestBan, createTestGroupBan, createTestSceneBan } from '../../../mocks/bans-db-mock'
import { createLogsMockComponent } from '../../../mocks/logs-mock'
import { createConfigJestMockComponent } from '../../../mocks/config-mock'

describe('get-bans-handler', () => {
  const TEST_ADDRESS = '0x1234567890123456789012345678901234567890'
  const ALLOWED_ADDRESS = '0xABCDEF1234567890123456789012345678901234'

  let mockBansDb: ReturnType<typeof createBansDbJestMockComponent>
  let mockLogs: ReturnType<typeof createLogsMockComponent>
  let mockConfig: ReturnType<typeof createConfigJestMockComponent>

  beforeEach(() => {
    mockBansDb = createBansDbJestMockComponent()
    mockLogs = createLogsMockComponent()
    mockConfig = createConfigJestMockComponent({ ALLOWED_USERS: ALLOWED_ADDRESS })
  })

  function createContext(auth: string | undefined) {
    return {
      components: {
        bansDb: mockBansDb,
        logs: mockLogs,
        config: mockConfig
      },
      verification: auth ? { auth } : undefined
    }
  }

  describe('when the request is not authenticated', () => {
    it('should return 401 Unauthorized', async () => {
      const context = createContext(undefined)
      const response = await getBansHandler(context as any)

      expect(response.status).toBe(401)
      expect(response.body).toEqual({ ok: false, error: 'Unauthorized' })
    })
  })

  describe('when the user is not in ALLOWED_USERS', () => {
    it('should return 403 Forbidden', async () => {
      const context = createContext(TEST_ADDRESS)
      const response = await getBansHandler(context as any)

      expect(response.status).toBe(403)
      expect(response.body).toEqual({ ok: false, error: 'Forbidden: User not in allowed list' })
    })
  })

  describe('when the user is allowed', () => {
    describe('and there are no bans', () => {
      it('should return 200 with empty array', async () => {
        mockBansDb.getAllBans.mockResolvedValue([])

        const context = createContext(ALLOWED_ADDRESS)
        const response = await getBansHandler(context as any)

        expect(response.status).toBe(200)
        expect(response.body).toEqual({ ok: true, data: [] })
      })
    })

    describe('and there are bans', () => {
      it('should return 200 with all bans', async () => {
        const bans = [
          createTestGroupBan('group-1', { id: 'ban-1' }),
          createTestSceneBan(['0,0'], { id: 'ban-2' }),
          createTestGroupBan('group-2', { id: 'ban-3' })
        ]
        mockBansDb.getAllBans.mockResolvedValue(bans)

        const context = createContext(ALLOWED_ADDRESS)
        const response = await getBansHandler(context as any)

        expect(response.status).toBe(200)
        expect(response.body).toEqual({ ok: true, data: bans })
        expect(response.body.data).toHaveLength(3)
      })

      it('should include both group and scene bans', async () => {
        const groupBan = createTestGroupBan('group-1', { id: 'group-ban' })
        const sceneBan = createTestSceneBan(['10,20'], { id: 'scene-ban' })
        mockBansDb.getAllBans.mockResolvedValue([groupBan, sceneBan])

        const context = createContext(ALLOWED_ADDRESS)
        const response = await getBansHandler(context as any)

        expect(response.status).toBe(200)
        expect(response.body.data).toContainEqual(expect.objectContaining({ id: 'group-ban', groupId: 'group-1' }))
        expect(response.body.data).toContainEqual(expect.objectContaining({ id: 'scene-ban', groupId: null }))
      })
    })

    describe('and the database throws an error', () => {
      it('should return 500 Internal Server Error', async () => {
        mockBansDb.getAllBans.mockRejectedValue(new Error('Database error'))

        const context = createContext(ALLOWED_ADDRESS)
        const response = await getBansHandler(context as any)

        expect(response.status).toBe(500)
        expect(response.body).toEqual({ ok: false, error: 'Internal server error' })
      })

      it('should log the error', async () => {
        mockBansDb.getAllBans.mockRejectedValue(new Error('Database connection failed'))

        const context = createContext(ALLOWED_ADDRESS)
        await getBansHandler(context as any)

        const logger = mockLogs.getLogger('get-bans')
        expect(logger.error).toHaveBeenCalledWith('Error fetching bans', expect.objectContaining({
          error: 'Database connection failed'
        }))
      })
    })
  })
})
