import { cancelDeletionHandler } from '../../src/controllers/handlers/cancel-deletion-handler'
import { createDbJestMockComponent, createTestDeletionRequest } from '../mocks/db-mock'
import { createSlackJestMockComponent } from '../mocks/slack-mock'
import { createLogsMockComponent } from '../mocks/logs-mock'

describe('cancel-deletion-handler', () => {
  const TEST_ADDRESS = '0x1234567890123456789012345678901234567890'
  const TEST_AUTH_CHAIN = [
    { type: 'SIGNER', payload: TEST_ADDRESS, signature: '' },
    { type: 'ECDSA_EPHEMERAL', payload: 'test-payload', signature: 'test-signature' }
  ]

  let mockDb: ReturnType<typeof createDbJestMockComponent>
  let mockSlack: ReturnType<typeof createSlackJestMockComponent>
  let mockLogs: ReturnType<typeof createLogsMockComponent>

  beforeEach(() => {
    mockDb = createDbJestMockComponent()
    mockSlack = createSlackJestMockComponent()
    mockLogs = createLogsMockComponent()
  })

  function createMockHeaders() {
    const headersMap = new Map<string, string>()
    headersMap.set('x-identity-auth-chain-0', JSON.stringify(TEST_AUTH_CHAIN[0]))
    headersMap.set('x-identity-auth-chain-1', JSON.stringify(TEST_AUTH_CHAIN[1]))
    return {
      forEach: (cb: (value: string, key: string) => void) => headersMap.forEach((v, k) => cb(v, k)),
      get: (key: string) => headersMap.get(key)
    }
  }

  function createContext(auth?: string) {
    return {
      components: {
        db: mockDb,
        slack: mockSlack,
        logs: mockLogs
      },
      verification: auth ? { auth } : undefined,
      request: {
        headers: createMockHeaders()
      }
    }
  }

  describe('when the request is not authenticated', () => {
    it('should return 401 Unauthorized', async () => {
      const context = createContext(undefined)

      const response = await cancelDeletionHandler(context as any)

      expect(response.status).toBe(401)
      expect(response.body).toEqual({ ok: false, error: 'Unauthorized' })
    })

    it('should not call the database', async () => {
      const context = createContext(undefined)

      await cancelDeletionHandler(context as any)

      expect(mockDb.cancelDeletionRequest).not.toHaveBeenCalled()
    })

    it('should not send slack notification', async () => {
      const context = createContext(undefined)

      await cancelDeletionHandler(context as any)

      expect(mockSlack.sendCancellationNotification).not.toHaveBeenCalled()
    })
  })

  describe('when the request is authenticated', () => {
    describe('and there is no pending deletion request', () => {
      beforeEach(() => {
        mockDb.cancelDeletionRequest.mockResolvedValue(null)
      })

      it('should return 404 Not Found', async () => {
        const context = createContext(TEST_ADDRESS)

        const response = await cancelDeletionHandler(context as any)

        expect(response.status).toBe(404)
        expect(response.body).toEqual({ ok: false, error: 'No pending deletion request found' })
      })

      it('should call cancelDeletionRequest with the user address', async () => {
        const context = createContext(TEST_ADDRESS)

        await cancelDeletionHandler(context as any)

        expect(mockDb.cancelDeletionRequest).toHaveBeenCalledWith(TEST_ADDRESS)
      })

      it('should not send a Slack notification', async () => {
        const context = createContext(TEST_ADDRESS)

        await cancelDeletionHandler(context as any)

        expect(mockSlack.sendCancellationNotification).not.toHaveBeenCalled()
      })
    })

    describe('and the deletion request is cancelled successfully', () => {
      const cancelledAt = new Date('2024-01-20T14:00:00Z')
      const mockCancelledRequest = createTestDeletionRequest({
        userAddress: TEST_ADDRESS.toLowerCase(),
        requestedAt: new Date('2024-01-15T10:30:00Z'),
        cancelledAt: cancelledAt,
        status: 'cancelled'
      })

      beforeEach(() => {
        mockDb.cancelDeletionRequest.mockResolvedValue(mockCancelledRequest)
      })

      it('should return 200 with the cancelled deletion request data', async () => {
        const context = createContext(TEST_ADDRESS)

        const response = await cancelDeletionHandler(context as any)

        expect(response.status).toBe(200)
        expect(response.body).toEqual({
          ok: true,
          data: {
            userAddress: mockCancelledRequest.userAddress,
            requestedAt: mockCancelledRequest.requestedAt,
            cancelledAt: cancelledAt,
            status: 'cancelled'
          }
        })
      })

      it('should send a Slack notification with auth chain', async () => {
        const context = createContext(TEST_ADDRESS)

        await cancelDeletionHandler(context as any)

        // Wait for the fire-and-forget promise
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(mockSlack.sendCancellationNotification).toHaveBeenCalledWith(TEST_ADDRESS, TEST_AUTH_CHAIN)
      })

      it('should log the cancellation', async () => {
        const context = createContext(TEST_ADDRESS)

        await cancelDeletionHandler(context as any)

        const logger = mockLogs.getLogger('cancel-deletion')
        expect(logger.info).toHaveBeenCalledWith('Deletion request cancelled', { userAddress: TEST_ADDRESS })
      })
    })

    describe('and the deletion request was already cancelled', () => {
      beforeEach(() => {
        // cancelDeletionRequest only updates where status = 'pending'
        // so it returns null if already cancelled
        mockDb.cancelDeletionRequest.mockResolvedValue(null)
      })

      it('should return 404 Not Found', async () => {
        const context = createContext(TEST_ADDRESS)

        const response = await cancelDeletionHandler(context as any)

        expect(response.status).toBe(404)
        expect(response.body).toEqual({ ok: false, error: 'No pending deletion request found' })
      })
    })

    describe('and the database throws an error', () => {
      beforeEach(() => {
        mockDb.cancelDeletionRequest.mockRejectedValue(new Error('Database update failed'))
      })

      it('should return 500 Internal Server Error', async () => {
        const context = createContext(TEST_ADDRESS)

        const response = await cancelDeletionHandler(context as any)

        expect(response.status).toBe(500)
        expect(response.body).toEqual({ ok: false, error: 'Internal server error' })
      })

      it('should log the error', async () => {
        const context = createContext(TEST_ADDRESS)

        await cancelDeletionHandler(context as any)

        const logger = mockLogs.getLogger('cancel-deletion')
        expect(logger.error).toHaveBeenCalledWith('Error cancelling deletion request', {
          error: 'Database update failed',
          userAddress: TEST_ADDRESS
        })
      })

      it('should not send a Slack notification', async () => {
        const context = createContext(TEST_ADDRESS)

        await cancelDeletionHandler(context as any)

        expect(mockSlack.sendCancellationNotification).not.toHaveBeenCalled()
      })
    })

    describe('and the Slack notification fails', () => {
      const mockCancelledRequest = createTestDeletionRequest({
        userAddress: TEST_ADDRESS.toLowerCase(),
        cancelledAt: new Date(),
        status: 'cancelled'
      })

      beforeEach(() => {
        mockDb.cancelDeletionRequest.mockResolvedValue(mockCancelledRequest)
        mockSlack.sendCancellationNotification.mockRejectedValue(new Error('Slack webhook failed'))
      })

      it('should still return 200 success (fire and forget)', async () => {
        const context = createContext(TEST_ADDRESS)

        const response = await cancelDeletionHandler(context as any)

        expect(response.status).toBe(200)
        expect(response.body).toMatchObject({ ok: true })
      })

      it('should log the Slack error', async () => {
        const context = createContext(TEST_ADDRESS)

        await cancelDeletionHandler(context as any)

        // Wait for the fire-and-forget promise to complete
        await new Promise((resolve) => setTimeout(resolve, 10))

        const logger = mockLogs.getLogger('cancel-deletion')
        expect(logger.error).toHaveBeenCalledWith('Failed to send Slack notification', {
          error: 'Slack webhook failed'
        })
      })
    })
  })

  describe('edge cases', () => {
    describe('when cancelling a request that was just created', () => {
      const now = new Date()
      const mockCancelledRequest = createTestDeletionRequest({
        userAddress: TEST_ADDRESS.toLowerCase(),
        requestedAt: now,
        cancelledAt: now,
        status: 'cancelled'
      })

      beforeEach(() => {
        mockDb.cancelDeletionRequest.mockResolvedValue(mockCancelledRequest)
      })

      it('should return success with matching requestedAt and cancelledAt times', async () => {
        const context = createContext(TEST_ADDRESS)

        const response = await cancelDeletionHandler(context as any)

        expect(response.status).toBe(200)
        expect(response.body).toMatchObject({
          ok: true,
          data: {
            requestedAt: now,
            cancelledAt: now
          }
        })
      })
    })
  })
})
