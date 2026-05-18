import { requestDeletionHandler } from '../../src/controllers/handlers/request-deletion-handler'
import { createDbJestMockComponent, createTestDeletionRequest } from '../mocks/db-mock'
import { createSlackJestMockComponent } from '../mocks/slack-mock'
import { createMagicJestMockComponent } from '../mocks/magic-mock'
import { createLogsMockComponent } from '../mocks/logs-mock'

describe('request-deletion-handler', () => {
  const TEST_ADDRESS = '0x1234567890123456789012345678901234567890'
  const TEST_AUTH_CHAIN = [
    { type: 'SIGNER', payload: TEST_ADDRESS, signature: '' },
    { type: 'ECDSA_EPHEMERAL', payload: 'test-payload', signature: 'test-signature' }
  ]

  let mockDb: ReturnType<typeof createDbJestMockComponent>
  let mockSlack: ReturnType<typeof createSlackJestMockComponent>
  let mockMagic: ReturnType<typeof createMagicJestMockComponent>
  let mockLogs: ReturnType<typeof createLogsMockComponent>

  beforeEach(() => {
    mockDb = createDbJestMockComponent()
    mockSlack = createSlackJestMockComponent()
    mockMagic = createMagicJestMockComponent()
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
        magic: mockMagic,
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

      const response = await requestDeletionHandler(context as any)

      expect(response.status).toBe(401)
      expect(response.body).toEqual({ ok: false, error: 'Unauthorized' })
    })

    it('should not call the database', async () => {
      const context = createContext(undefined)

      await requestDeletionHandler(context as any)

      expect(mockDb.createDeletionRequest).not.toHaveBeenCalled()
    })

    it('should not send slack notification', async () => {
      const context = createContext(undefined)

      await requestDeletionHandler(context as any)

      expect(mockSlack.sendDeletionRequestNotification).not.toHaveBeenCalled()
    })

    it('should not call Magic', async () => {
      const context = createContext(undefined)

      await requestDeletionHandler(context as any)

      expect(mockMagic.requestDeletion).not.toHaveBeenCalled()
    })
  })

  describe('when the request is authenticated', () => {
    describe('and the deletion request is created successfully', () => {
      const mockDeletionRequest = createTestDeletionRequest({
        userAddress: TEST_ADDRESS.toLowerCase(),
        status: 'pending'
      })

      beforeEach(() => {
        mockDb.createDeletionRequest.mockResolvedValue(mockDeletionRequest)
      })

      it('should return 201 immediately with magic queued for background processing', async () => {
        const context = createContext(TEST_ADDRESS)

        const response = await requestDeletionHandler(context as any)

        expect(response.status).toBe(201)
        expect(response.body).toEqual({
          ok: true,
          data: {
            userAddress: mockDeletionRequest.userAddress,
            requestedAt: mockDeletionRequest.requestedAt,
            status: mockDeletionRequest.status,
            magic: { status: 'queued' }
          }
        })
      })

      it('should call createDeletionRequest with the user address', async () => {
        const context = createContext(TEST_ADDRESS)

        await requestDeletionHandler(context as any)

        expect(mockDb.createDeletionRequest).toHaveBeenCalledWith(TEST_ADDRESS)
      })

      it('should call Magic with the user address', async () => {
        const context = createContext(TEST_ADDRESS)

        await requestDeletionHandler(context as any)

        expect(mockMagic.requestDeletion).toHaveBeenCalledWith(TEST_ADDRESS)
      })

      it('should send a Slack notification with auth chain and Magic result', async () => {
        const context = createContext(TEST_ADDRESS)

        await requestDeletionHandler(context as any)

        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(mockSlack.sendDeletionRequestNotification).toHaveBeenCalledWith(
          TEST_ADDRESS,
          TEST_AUTH_CHAIN,
          { status: 'processed' }
        )
      })

      it('should log the deletion request creation', async () => {
        const context = createContext(TEST_ADDRESS)

        await requestDeletionHandler(context as any)

        const logger = mockLogs.getLogger('request-deletion')
        expect(logger.info).toHaveBeenCalledWith('Deletion request created', { userAddress: TEST_ADDRESS })
      })
    })

    describe('and Magic processes the deletion', () => {
      beforeEach(() => {
        mockDb.createDeletionRequest.mockResolvedValue(
          createTestDeletionRequest({ userAddress: TEST_ADDRESS.toLowerCase() })
        )
        mockMagic.requestDeletion.mockResolvedValue({ status: 'processed', email: 'user@example.com' })
      })

      it('should still return queued (Magic runs in the background)', async () => {
        const context = createContext(TEST_ADDRESS)

        const response = await requestDeletionHandler(context as any)

        expect(response.status).toBe(201)
        expect(response.body).toMatchObject({
          ok: true,
          data: { magic: { status: 'queued' } }
        })
      })

      it('should forward the Magic result to Slack after the background call finishes', async () => {
        const context = createContext(TEST_ADDRESS)

        await requestDeletionHandler(context as any)

        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(mockSlack.sendDeletionRequestNotification).toHaveBeenCalledWith(
          TEST_ADDRESS,
          TEST_AUTH_CHAIN,
          { status: 'processed', email: 'user@example.com' }
        )
      })
    })

    describe('and Magic does not know the address', () => {
      beforeEach(() => {
        mockDb.createDeletionRequest.mockResolvedValue(
          createTestDeletionRequest({ userAddress: TEST_ADDRESS.toLowerCase() })
        )
        mockMagic.requestDeletion.mockResolvedValue({ status: 'not_found' })
      })

      it('should still record the request and return 201 queued', async () => {
        const context = createContext(TEST_ADDRESS)

        const response = await requestDeletionHandler(context as any)

        expect(response.status).toBe(201)
        expect(response.body).toMatchObject({ ok: true, data: { magic: { status: 'queued' } } })
        expect(mockDb.createDeletionRequest).toHaveBeenCalled()
      })

      it('should forward not_found to Slack so the adapter can suppress the Magic line', async () => {
        const context = createContext(TEST_ADDRESS)

        await requestDeletionHandler(context as any)

        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(mockSlack.sendDeletionRequestNotification).toHaveBeenCalledWith(
          TEST_ADDRESS,
          TEST_AUTH_CHAIN,
          { status: 'not_found' }
        )
      })
    })

    describe('and Magic returns an error', () => {
      beforeEach(() => {
        mockDb.createDeletionRequest.mockResolvedValue(
          createTestDeletionRequest({ userAddress: TEST_ADDRESS.toLowerCase() })
        )
        mockMagic.requestDeletion.mockResolvedValue({ status: 'error', error: 'HTTP 500' })
      })

      it('should still return 201 queued (Magic failure must not block the request)', async () => {
        const context = createContext(TEST_ADDRESS)

        const response = await requestDeletionHandler(context as any)

        expect(response.status).toBe(201)
        expect(response.body).toMatchObject({ ok: true, data: { magic: { status: 'queued' } } })
      })

      it('should propagate the Magic error to Slack so the team is alerted', async () => {
        const context = createContext(TEST_ADDRESS)

        await requestDeletionHandler(context as any)

        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(mockSlack.sendDeletionRequestNotification).toHaveBeenCalledWith(
          TEST_ADDRESS,
          TEST_AUTH_CHAIN,
          { status: 'error', error: 'HTTP 500' }
        )
      })
    })

    describe('and the user already has a pending deletion request', () => {
      const existingRequest = createTestDeletionRequest({
        userAddress: TEST_ADDRESS.toLowerCase(),
        requestedAt: new Date('2024-01-01T00:00:00Z'),
        status: 'pending'
      })

      beforeEach(() => {
        // ON CONFLICT DO UPDATE returns the updated row
        mockDb.createDeletionRequest.mockResolvedValue({
          ...existingRequest,
          requestedAt: new Date() // Updated timestamp
        })
      })

      it('should return 201 with the updated deletion request', async () => {
        const context = createContext(TEST_ADDRESS)

        const response = await requestDeletionHandler(context as any)

        expect(response.status).toBe(201)
        expect(response.body).toMatchObject({
          ok: true,
          data: {
            userAddress: existingRequest.userAddress,
            status: 'pending'
          }
        })
      })
    })

    describe('and the database throws an error', () => {
      beforeEach(() => {
        mockDb.createDeletionRequest.mockRejectedValue(new Error('Database connection failed'))
      })

      it('should return 500 Internal Server Error', async () => {
        const context = createContext(TEST_ADDRESS)

        const response = await requestDeletionHandler(context as any)

        expect(response.status).toBe(500)
        expect(response.body).toEqual({ ok: false, error: 'Internal server error' })
      })

      it('should log the error', async () => {
        const context = createContext(TEST_ADDRESS)

        await requestDeletionHandler(context as any)

        const logger = mockLogs.getLogger('request-deletion')
        expect(logger.error).toHaveBeenCalledWith('Error creating deletion request', {
          error: 'Database connection failed',
          userAddress: TEST_ADDRESS
        })
      })

      it('should not send a Slack notification', async () => {
        const context = createContext(TEST_ADDRESS)

        await requestDeletionHandler(context as any)

        expect(mockSlack.sendDeletionRequestNotification).not.toHaveBeenCalled()
      })
    })

    describe('and the Slack notification fails', () => {
      const mockDeletionRequest = createTestDeletionRequest({
        userAddress: TEST_ADDRESS.toLowerCase()
      })

      beforeEach(() => {
        mockDb.createDeletionRequest.mockResolvedValue(mockDeletionRequest)
        mockSlack.sendDeletionRequestNotification.mockRejectedValue(new Error('Slack webhook failed'))
      })

      it('should still return 201 success (fire and forget)', async () => {
        const context = createContext(TEST_ADDRESS)

        const response = await requestDeletionHandler(context as any)

        expect(response.status).toBe(201)
        expect(response.body).toMatchObject({ ok: true })
      })

      it('should log the Slack error', async () => {
        const context = createContext(TEST_ADDRESS)

        await requestDeletionHandler(context as any)

        // Wait for the fire-and-forget promise to complete
        await new Promise((resolve) => setTimeout(resolve, 10))

        const logger = mockLogs.getLogger('request-deletion')
        expect(logger.error).toHaveBeenCalledWith('Background Magic/Slack pipeline failed', {
          error: 'Slack webhook failed',
          userAddress: TEST_ADDRESS
        })
      })
    })
  })
})
