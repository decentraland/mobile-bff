import { createSceneGroupHandler } from '../../../../src/controllers/handlers/backoffice/scene-groups/create-scene-group-handler'
import { createSceneGroupsDbJestMockComponent, createTestSceneGroup } from '../../../mocks/scene-groups-db-mock'
import { createLogsMockComponent } from '../../../mocks/logs-mock'
import { createConfigJestMockComponent } from '../../../mocks/config-mock'

describe('create-scene-group-handler', () => {
  const TEST_ADDRESS = '0x1234567890123456789012345678901234567890'
  const ALLOWED_ADDRESS = '0xABCDEF1234567890123456789012345678901234'

  let mockSceneGroupsDb: ReturnType<typeof createSceneGroupsDbJestMockComponent>
  let mockLogs: ReturnType<typeof createLogsMockComponent>
  let mockConfig: ReturnType<typeof createConfigJestMockComponent>

  beforeEach(() => {
    mockSceneGroupsDb = createSceneGroupsDbJestMockComponent()
    mockLogs = createLogsMockComponent()
    mockConfig = createConfigJestMockComponent({ ALLOWED_USERS: ALLOWED_ADDRESS })
  })

  function createContext(auth: string | undefined, body: any) {
    return {
      components: {
        sceneGroupsDb: mockSceneGroupsDb,
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
      const response = await createSceneGroupHandler(context as any)

      expect(response.status).toBe(401)
      expect(response.body).toEqual({ ok: false, error: 'Unauthorized' })
    })
  })

  describe('when the user is not in ALLOWED_USERS', () => {
    it('should return 403 Forbidden', async () => {
      const context = createContext(TEST_ADDRESS, {})
      const response = await createSceneGroupHandler(context as any)

      expect(response.status).toBe(403)
      expect(response.body).toEqual({ ok: false, error: 'Forbidden: User not in allowed list' })
    })
  })

  describe('when the user is allowed', () => {
    describe('and validation fails', () => {
      it('should return 400 when name is missing', async () => {
        const context = createContext(ALLOWED_ADDRESS, { color: '#FF0000', parcels: [] })
        const response = await createSceneGroupHandler(context as any)

        expect(response.status).toBe(400)
        expect(response.body.error).toContain('name')
      })

      it('should return 400 when color is missing', async () => {
        const context = createContext(ALLOWED_ADDRESS, { name: 'Test', parcels: [] })
        const response = await createSceneGroupHandler(context as any)

        expect(response.status).toBe(400)
        expect(response.body.error).toContain('color')
      })

      it('should return 400 when parcels is missing', async () => {
        const context = createContext(ALLOWED_ADDRESS, { name: 'Test', color: '#FF0000' })
        const response = await createSceneGroupHandler(context as any)

        expect(response.status).toBe(400)
        expect(response.body.error).toContain('parcels')
      })

      it('should return 400 when color format is invalid', async () => {
        const context = createContext(ALLOWED_ADDRESS, {
          name: 'Test',
          color: 'red',
          parcels: [{ x: 0, y: 0 }]
        })
        const response = await createSceneGroupHandler(context as any)

        expect(response.status).toBe(400)
        expect(response.body.error).toContain('color format')
      })

      it('should return 400 when parcels have invalid structure', async () => {
        const context = createContext(ALLOWED_ADDRESS, {
          name: 'Test',
          color: '#FF0000',
          parcels: [{ x: 'invalid', y: 0 }]
        })
        const response = await createSceneGroupHandler(context as any)

        expect(response.status).toBe(400)
        expect(response.body.error).toContain('parcels format')
      })
    })

    describe('and the scene group is created successfully', () => {
      const validInput = {
        name: 'My Group',
        description: 'A test group',
        color: '#FF6B6B',
        tags: ['test'],
        parcels: [{ x: 0, y: 0 }, { x: 1, y: 0 }]
      }

      it('should return 201 with the created group', async () => {
        const createdGroup = createTestSceneGroup(validInput)
        mockSceneGroupsDb.createSceneGroup.mockResolvedValue(createdGroup)

        const context = createContext(ALLOWED_ADDRESS, validInput)
        const response = await createSceneGroupHandler(context as any)

        expect(response.status).toBe(201)
        expect(response.body).toEqual({ ok: true, data: createdGroup })
      })

      it('should call createSceneGroup with the input', async () => {
        const context = createContext(ALLOWED_ADDRESS, validInput)
        await createSceneGroupHandler(context as any)

        expect(mockSceneGroupsDb.createSceneGroup).toHaveBeenCalledWith(validInput)
      })

      it('should log the creation', async () => {
        const createdGroup = createTestSceneGroup(validInput)
        mockSceneGroupsDb.createSceneGroup.mockResolvedValue(createdGroup)

        const context = createContext(ALLOWED_ADDRESS, validInput)
        await createSceneGroupHandler(context as any)

        const logger = mockLogs.getLogger('create-scene-group')
        expect(logger.info).toHaveBeenCalledWith('Scene group created', {
          id: createdGroup.id,
          createdBy: ALLOWED_ADDRESS
        })
      })
    })

    describe('and a parcel already belongs to another group', () => {
      it('should return 409 Conflict', async () => {
        mockSceneGroupsDb.createSceneGroup.mockRejectedValue(new Error('duplicate key value violates unique constraint'))

        const context = createContext(ALLOWED_ADDRESS, {
          name: 'Test',
          color: '#FF0000',
          parcels: [{ x: 0, y: 0 }]
        })
        const response = await createSceneGroupHandler(context as any)

        expect(response.status).toBe(409)
        expect(response.body.error).toContain('already belong to another')
      })
    })

    describe('and the database throws an error', () => {
      it('should return 500 Internal Server Error', async () => {
        mockSceneGroupsDb.createSceneGroup.mockRejectedValue(new Error('Database error'))

        const context = createContext(ALLOWED_ADDRESS, {
          name: 'Test',
          color: '#FF0000',
          parcels: [{ x: 0, y: 0 }]
        })
        const response = await createSceneGroupHandler(context as any)

        expect(response.status).toBe(500)
        expect(response.body).toEqual({ ok: false, error: 'Internal server error' })
      })
    })
  })
})
