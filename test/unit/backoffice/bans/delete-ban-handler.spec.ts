import { deleteBanHandler } from '../../../../src/controllers/handlers/backoffice/bans/delete-ban-handler'
import { createBansDbJestMockComponent } from '../../../mocks/bans-db-mock'
import { createLogsMockComponent } from '../../../mocks/logs-mock'
import { createConfigJestMockComponent } from '../../../mocks/config-mock'

describe('delete-ban-handler', () => {
  const TEST_ADDRESS = '0x1234567890123456789012345678901234567890'
  const ALLOWED_ADDRESS = '0xABCDEF1234567890123456789012345678901234'
  const BAN_ID = 'test-ban-id-123'

  let mockBansDb: ReturnType<typeof createBansDbJestMockComponent>
  let mockLogs: ReturnType<typeof createLogsMockComponent>
  let mockConfig: ReturnType<typeof createConfigJestMockComponent>

  beforeEach(() => {
    mockBansDb = createBansDbJestMockComponent()
    mockLogs = createLogsMockComponent()
    mockConfig = createConfigJestMockComponent({ ALLOWED_USERS: ALLOWED_ADDRESS })
  })

  function createContext(auth: string | undefined, id: string) {
    return {
      components: {
        bansDb: mockBansDb,
        logs: mockLogs,
        config: mockConfig
      },
      verification: auth ? { auth } : undefined,
      params: { id }
    }
  }

  describe('when the request is not authenticated', () => {
    it('should return 401 Unauthorized', async () => {
      const context = createContext(undefined, BAN_ID)
      const response = await deleteBanHandler(context as any)

      expect(response.status).toBe(401)
      expect(response.body).toEqual({ ok: false, error: 'Unauthorized' })
    })
  })

  describe('when the user is not in ALLOWED_USERS', () => {
    it('should return 403 Forbidden', async () => {
      const context = createContext(TEST_ADDRESS, BAN_ID)
      const response = await deleteBanHandler(context as any)

      expect(response.status).toBe(403)
      expect(response.body).toEqual({ ok: false, error: 'Forbidden: User not in allowed list' })
    })
  })

  describe('when the user is allowed', () => {
    describe('and the ban exists', () => {
      it('should return 200 with the deleted ban id', async () => {
        mockBansDb.deleteBan.mockResolvedValue(true)

        const context = createContext(ALLOWED_ADDRESS, BAN_ID)
        const response = await deleteBanHandler(context as any)

        expect(response.status).toBe(200)
        expect(response.body).toEqual({ ok: true, data: { id: BAN_ID } })
      })

      it('should call deleteBan with the id', async () => {
        mockBansDb.deleteBan.mockResolvedValue(true)

        const context = createContext(ALLOWED_ADDRESS, BAN_ID)
        await deleteBanHandler(context as any)

        expect(mockBansDb.deleteBan).toHaveBeenCalledWith(BAN_ID)
      })

      it('should log the deletion', async () => {
        mockBansDb.deleteBan.mockResolvedValue(true)

        const context = createContext(ALLOWED_ADDRESS, BAN_ID)
        await deleteBanHandler(context as any)

        const logger = mockLogs.getLogger('delete-ban')
        expect(logger.info).toHaveBeenCalledWith('Ban deleted', {
          id: BAN_ID,
          deletedBy: ALLOWED_ADDRESS
        })
      })
    })

    describe('and the ban does not exist', () => {
      it('should return 404 Not Found', async () => {
        mockBansDb.deleteBan.mockResolvedValue(false)

        const context = createContext(ALLOWED_ADDRESS, 'non-existent-ban')
        const response = await deleteBanHandler(context as any)

        expect(response.status).toBe(404)
        expect(response.body).toEqual({ ok: false, error: 'Ban not found' })
      })
    })

    describe('and the database throws an error', () => {
      it('should return 500 Internal Server Error', async () => {
        mockBansDb.deleteBan.mockRejectedValue(new Error('Database error'))

        const context = createContext(ALLOWED_ADDRESS, BAN_ID)
        const response = await deleteBanHandler(context as any)

        expect(response.status).toBe(500)
        expect(response.body).toEqual({ ok: false, error: 'Internal server error' })
      })

      it('should log the error', async () => {
        mockBansDb.deleteBan.mockRejectedValue(new Error('Connection lost'))

        const context = createContext(ALLOWED_ADDRESS, BAN_ID)
        await deleteBanHandler(context as any)

        const logger = mockLogs.getLogger('delete-ban')
        expect(logger.error).toHaveBeenCalledWith('Error deleting ban', expect.objectContaining({
          error: 'Connection lost',
          id: BAN_ID,
          deletedBy: ALLOWED_ADDRESS
        }))
      })
    })
  })
})
