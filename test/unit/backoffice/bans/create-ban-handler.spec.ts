import { createBanHandler } from '../../../../src/controllers/handlers/backoffice/bans/create-ban-handler'
import { createBansDbJestMockComponent, createTestBan, createTestGroupBan, createTestSceneBan } from '../../../mocks/bans-db-mock'
import { createLogsMockComponent } from '../../../mocks/logs-mock'
import { createConfigJestMockComponent } from '../../../mocks/config-mock'

describe('create-ban-handler', () => {
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

  function createContext(auth: string | undefined, body: any) {
    return {
      components: {
        bansDb: mockBansDb,
        logs: mockLogs,
        config: mockConfig
      },
      verification: auth ? { auth } : undefined,
      request: {
        json: () => Promise.resolve(body)
      }
    }
  }

  describe('when the request is not authenticated', () => {
    it('should return 401 Unauthorized', async () => {
      const context = createContext(undefined, {})
      const response = await createBanHandler(context as any)

      expect(response.status).toBe(401)
      expect(response.body).toEqual({ ok: false, error: 'Unauthorized' })
    })
  })

  describe('when the user is not in ALLOWED_USERS', () => {
    it('should return 403 Forbidden', async () => {
      const context = createContext(TEST_ADDRESS, {})
      const response = await createBanHandler(context as any)

      expect(response.status).toBe(403)
      expect(response.body).toEqual({ ok: false, error: 'Forbidden: User not in allowed list' })
    })
  })

  describe('when the user is allowed', () => {
    describe('and validation fails', () => {
      it('should return 400 when neither groupId nor parcels is provided', async () => {
        const context = createContext(ALLOWED_ADDRESS, {})
        const response = await createBanHandler(context as any)

        expect(response.status).toBe(400)
        expect(response.body.error).toContain('groupId')
      })

      it('should return 400 when both groupId and parcels are provided', async () => {
        const context = createContext(ALLOWED_ADDRESS, {
          groupId: 'some-group-id',
          parcels: [{ x: 0, y: 0 }]
        })
        const response = await createBanHandler(context as any)

        expect(response.status).toBe(400)
        expect(response.body.error).toContain('Cannot specify both')
      })

      it('should return 400 when parcels have invalid structure', async () => {
        const context = createContext(ALLOWED_ADDRESS, {
          parcels: [{ x: 'invalid', y: 0 }]
        })
        const response = await createBanHandler(context as any)

        expect(response.status).toBe(400)
        expect(response.body.error).toContain('parcels format')
      })

      it('should return 400 when parcels array is empty', async () => {
        const context = createContext(ALLOWED_ADDRESS, {
          parcels: []
        })
        const response = await createBanHandler(context as any)

        expect(response.status).toBe(400)
        expect(response.body.error).toContain('groupId')
      })
    })

    describe('and creating a group ban', () => {
      const validGroupBanInput = {
        groupId: 'test-group-id',
        reason: 'Test ban reason'
      }

      it('should return 201 with the created ban', async () => {
        const createdBan = createTestGroupBan(validGroupBanInput.groupId, {
          reason: validGroupBanInput.reason,
          createdBy: ALLOWED_ADDRESS
        })
        mockBansDb.createGroupBan.mockResolvedValue(createdBan)

        const context = createContext(ALLOWED_ADDRESS, validGroupBanInput)
        const response = await createBanHandler(context as any)

        expect(response.status).toBe(201)
        expect(response.body).toEqual({ ok: true, data: createdBan })
      })

      it('should call createGroupBan with the input', async () => {
        const context = createContext(ALLOWED_ADDRESS, validGroupBanInput)
        await createBanHandler(context as any)

        expect(mockBansDb.createGroupBan).toHaveBeenCalledWith(
          { groupId: validGroupBanInput.groupId, reason: validGroupBanInput.reason },
          ALLOWED_ADDRESS
        )
      })

      it('should log the creation', async () => {
        const createdBan = createTestGroupBan(validGroupBanInput.groupId)
        mockBansDb.createGroupBan.mockResolvedValue(createdBan)

        const context = createContext(ALLOWED_ADDRESS, validGroupBanInput)
        await createBanHandler(context as any)

        const logger = mockLogs.getLogger('create-ban')
        expect(logger.info).toHaveBeenCalledWith('Group ban created', expect.objectContaining({
          id: createdBan.id,
          createdBy: ALLOWED_ADDRESS
        }))
      })
    })

    describe('and creating a scene ban', () => {
      const validSceneBanInput = {
        parcels: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
        reason: 'Test scene ban reason'
      }

      it('should return 201 with the created ban', async () => {
        const createdBan = createTestSceneBan(validSceneBanInput.parcels, {
          reason: validSceneBanInput.reason,
          createdBy: ALLOWED_ADDRESS
        })
        mockBansDb.createSceneBan.mockResolvedValue(createdBan)

        const context = createContext(ALLOWED_ADDRESS, validSceneBanInput)
        const response = await createBanHandler(context as any)

        expect(response.status).toBe(201)
        expect(response.body).toEqual({ ok: true, data: createdBan })
      })

      it('should call createSceneBan with the input', async () => {
        const context = createContext(ALLOWED_ADDRESS, validSceneBanInput)
        await createBanHandler(context as any)

        expect(mockBansDb.createSceneBan).toHaveBeenCalledWith(
          { parcels: validSceneBanInput.parcels, reason: validSceneBanInput.reason },
          ALLOWED_ADDRESS
        )
      })

      it('should log the creation', async () => {
        const createdBan = createTestSceneBan(validSceneBanInput.parcels)
        mockBansDb.createSceneBan.mockResolvedValue(createdBan)

        const context = createContext(ALLOWED_ADDRESS, validSceneBanInput)
        await createBanHandler(context as any)

        const logger = mockLogs.getLogger('create-ban')
        expect(logger.info).toHaveBeenCalledWith('Scene ban created', expect.objectContaining({
          id: createdBan.id,
          createdBy: ALLOWED_ADDRESS
        }))
      })
    })

    describe('and the target is already banned', () => {
      it('should return 409 Conflict for duplicate group ban', async () => {
        mockBansDb.createGroupBan.mockRejectedValue(new Error('duplicate key value violates unique constraint'))

        const context = createContext(ALLOWED_ADDRESS, { groupId: 'test-group-id' })
        const response = await createBanHandler(context as any)

        expect(response.status).toBe(409)
        expect(response.body.error).toContain('already banned')
      })
    })

    describe('and the group does not exist', () => {
      it('should return 404 Not Found', async () => {
        mockBansDb.createGroupBan.mockRejectedValue(new Error('violates foreign key constraint'))

        const context = createContext(ALLOWED_ADDRESS, { groupId: 'non-existent-group' })
        const response = await createBanHandler(context as any)

        expect(response.status).toBe(404)
        expect(response.body.error).toContain('Group not found')
      })
    })

    describe('and the database throws an error', () => {
      it('should return 500 Internal Server Error', async () => {
        mockBansDb.createGroupBan.mockRejectedValue(new Error('Database error'))

        const context = createContext(ALLOWED_ADDRESS, { groupId: 'test-group-id' })
        const response = await createBanHandler(context as any)

        expect(response.status).toBe(500)
        expect(response.body).toEqual({ ok: false, error: 'Internal server error' })
      })
    })
  })
})
