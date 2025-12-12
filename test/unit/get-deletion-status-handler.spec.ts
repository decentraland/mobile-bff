import { getDeletionStatusHandler } from '../../src/controllers/handlers/get-deletion-status-handler'
import { createDbJestMockComponent, createTestDeletionRequest } from '../mocks/db-mock'
import { createLogsMockComponent } from '../mocks/logs-mock'

describe('get-deletion-status-handler', () => {
  const TEST_ADDRESS = '0x1234567890123456789012345678901234567890'

  let mockDb: ReturnType<typeof createDbJestMockComponent>
  let mockLogs: ReturnType<typeof createLogsMockComponent>

  beforeEach(() => {
    mockDb = createDbJestMockComponent()
    mockLogs = createLogsMockComponent()
  })

  function createContext(auth?: string) {
    return {
      components: {
        db: mockDb,
        logs: mockLogs
      },
      verification: auth ? { auth } : undefined
    }
  }

  describe('when the request is not authenticated', () => {
    it('should return 401 Unauthorized', async () => {
      const context = createContext(undefined)

      const response = await getDeletionStatusHandler(context as any)

      expect(response.status).toBe(401)
      expect(response.body).toEqual({ ok: false, error: 'Unauthorized' })
    })

    it('should not call the database', async () => {
      const context = createContext(undefined)

      await getDeletionStatusHandler(context as any)

      expect(mockDb.getDeletionRequest).not.toHaveBeenCalled()
    })
  })

  describe('when the request is authenticated', () => {
    describe('and the user has no deletion request', () => {
      beforeEach(() => {
        mockDb.getDeletionRequest.mockResolvedValue(null)
      })

      it('should return 200 with null data', async () => {
        const context = createContext(TEST_ADDRESS)

        const response = await getDeletionStatusHandler(context as any)

        expect(response.status).toBe(200)
        expect(response.body).toEqual({
          ok: true,
          data: null
        })
      })

      it('should call getDeletionRequest with the user address', async () => {
        const context = createContext(TEST_ADDRESS)

        await getDeletionStatusHandler(context as any)

        expect(mockDb.getDeletionRequest).toHaveBeenCalledWith(TEST_ADDRESS)
      })
    })

    describe('and the user has a pending deletion request', () => {
      const mockDeletionRequest = createTestDeletionRequest({
        userAddress: TEST_ADDRESS.toLowerCase(),
        requestedAt: new Date('2024-01-15T10:30:00Z'),
        cancelledAt: null,
        status: 'pending'
      })

      beforeEach(() => {
        mockDb.getDeletionRequest.mockResolvedValue(mockDeletionRequest)
      })

      it('should return 200 with the deletion request data', async () => {
        const context = createContext(TEST_ADDRESS)

        const response = await getDeletionStatusHandler(context as any)

        expect(response.status).toBe(200)
        expect(response.body).toEqual({
          ok: true,
          data: {
            userAddress: mockDeletionRequest.userAddress,
            requestedAt: mockDeletionRequest.requestedAt,
            cancelledAt: null,
            status: 'pending'
          }
        })
      })
    })

    describe('and the user has a cancelled deletion request', () => {
      const cancelledAt = new Date('2024-01-20T14:00:00Z')
      const mockDeletionRequest = createTestDeletionRequest({
        userAddress: TEST_ADDRESS.toLowerCase(),
        requestedAt: new Date('2024-01-15T10:30:00Z'),
        cancelledAt: cancelledAt,
        status: 'cancelled'
      })

      beforeEach(() => {
        mockDb.getDeletionRequest.mockResolvedValue(mockDeletionRequest)
      })

      it('should return 200 with the cancelled deletion request data', async () => {
        const context = createContext(TEST_ADDRESS)

        const response = await getDeletionStatusHandler(context as any)

        expect(response.status).toBe(200)
        expect(response.body).toEqual({
          ok: true,
          data: {
            userAddress: mockDeletionRequest.userAddress,
            requestedAt: mockDeletionRequest.requestedAt,
            cancelledAt: cancelledAt,
            status: 'cancelled'
          }
        })
      })
    })

    describe('and the database throws an error', () => {
      beforeEach(() => {
        mockDb.getDeletionRequest.mockRejectedValue(new Error('Database query failed'))
      })

      it('should return 500 Internal Server Error', async () => {
        const context = createContext(TEST_ADDRESS)

        const response = await getDeletionStatusHandler(context as any)

        expect(response.status).toBe(500)
        expect(response.body).toEqual({ ok: false, error: 'Internal server error' })
      })

      it('should log the error', async () => {
        const context = createContext(TEST_ADDRESS)

        await getDeletionStatusHandler(context as any)

        const logger = mockLogs.getLogger('get-deletion-status')
        expect(logger.error).toHaveBeenCalledWith('Error getting deletion status', {
          error: 'Database query failed',
          userAddress: TEST_ADDRESS
        })
      })
    })
  })

  describe('edge cases', () => {
    describe('when the user address has different casing', () => {
      const upperCaseAddress = '0xABCDEF1234567890123456789012345678901234'
      const mockDeletionRequest = createTestDeletionRequest({
        userAddress: upperCaseAddress.toLowerCase()
      })

      beforeEach(() => {
        mockDb.getDeletionRequest.mockResolvedValue(mockDeletionRequest)
      })

      it('should query with the exact address provided by verification', async () => {
        const context = createContext(upperCaseAddress)

        await getDeletionStatusHandler(context as any)

        expect(mockDb.getDeletionRequest).toHaveBeenCalledWith(upperCaseAddress)
      })
    })
  })
})
