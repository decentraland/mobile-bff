import { createFeatureFlagHandler } from '../../../../src/controllers/handlers/backoffice/feature-flags/create-feature-flag-handler'
import { createFeatureFlagsDbJestMockComponent } from '../../../mocks/feature-flags-db-mock'
import { createLogsMockComponent } from '../../../mocks/logs-mock'
import { createConfigJestMockComponent } from '../../../mocks/config-mock'

describe('create-feature-flag-handler', () => {
  const TEST_ADDRESS = '0x1234567890123456789012345678901234567890'
  const ALLOWED_ADDRESS = '0xABCDEF1234567890123456789012345678901234'

  let mockFeatureFlagsDb: ReturnType<typeof createFeatureFlagsDbJestMockComponent>
  let mockLogs: ReturnType<typeof createLogsMockComponent>
  let mockConfig: ReturnType<typeof createConfigJestMockComponent>

  beforeEach(() => {
    mockFeatureFlagsDb = createFeatureFlagsDbJestMockComponent()
    mockLogs = createLogsMockComponent()
    mockConfig = createConfigJestMockComponent({ ALLOWED_USERS: ALLOWED_ADDRESS })
  })

  function createContext(auth: string | undefined, body: any) {
    return {
      components: {
        featureFlagsDb: mockFeatureFlagsDb,
        logs: mockLogs,
        config: mockConfig
      },
      verification: auth ? { auth } : undefined,
      request: {
        json: () => Promise.resolve(body)
      }
    }
  }

  it('should return 401 when the request is not authenticated', async () => {
    const response = await createFeatureFlagHandler(createContext(undefined, { name: 'new-flag' }) as any)

    expect(response.status).toBe(401)
    expect(response.body).toEqual({ ok: false, error: 'Unauthorized' })
  })

  it('should return 403 when the user is not in ALLOWED_USERS', async () => {
    const response = await createFeatureFlagHandler(createContext(TEST_ADDRESS, { name: 'new-flag' }) as any)

    expect(response.status).toBe(403)
    expect(response.body).toEqual({ ok: false, error: 'Forbidden: User not in allowed list' })
  })

  describe('name validation', () => {
    it.each([
      ['missing', {}],
      ['empty', { name: '' }],
      ['not a string', { name: 42 }]
    ])('should return 400 when name is %s', async (_label, body) => {
      const response = await createFeatureFlagHandler(createContext(ALLOWED_ADDRESS, body) as any)

      expect(response.status).toBe(400)
      expect(response.body.error).toContain("'name' is required")
      expect(mockFeatureFlagsDb.create).not.toHaveBeenCalled()
    })

    it.each(['My Flag', 'UPPER', 'snake_case', '__proto__', '-leading', 'trailing-', 'double--dash'])(
      'should return 400 for non-kebab-case name %s',
      async (name) => {
        const response = await createFeatureFlagHandler(createContext(ALLOWED_ADDRESS, { name }) as any)

        expect(response.status).toBe(400)
        expect(response.body.error).toContain('kebab-case')
        expect(mockFeatureFlagsDb.create).not.toHaveBeenCalled()
      }
    )

    it('should return 400 when name is longer than 64 characters', async () => {
      const response = await createFeatureFlagHandler(
        createContext(ALLOWED_ADDRESS, { name: 'a'.repeat(65) }) as any
      )

      expect(response.status).toBe(400)
      expect(response.body.error).toContain('64 characters')
    })
  })

  it('should return 400 when enabled is not a boolean', async () => {
    const response = await createFeatureFlagHandler(
      createContext(ALLOWED_ADDRESS, { name: 'new-flag', enabled: 'true' }) as any
    )

    expect(response.status).toBe(400)
    expect(response.body).toEqual({ ok: false, error: "'enabled' must be a boolean" })
  })

  it('should return 400 when description is not a string', async () => {
    const response = await createFeatureFlagHandler(
      createContext(ALLOWED_ADDRESS, { name: 'new-flag', description: 42 }) as any
    )

    expect(response.status).toBe(400)
    expect(response.body.error).toContain("'description' must be a string")
  })

  it('should return 400 when description is longer than 500 characters', async () => {
    const response = await createFeatureFlagHandler(
      createContext(ALLOWED_ADDRESS, { name: 'new-flag', description: 'x'.repeat(501) }) as any
    )

    expect(response.status).toBe(400)
    expect(response.body.error).toContain('500 characters')
  })

  it('should create the flag with defaults (on-off, enabled=false, description=null) and return 201', async () => {
    const response = await createFeatureFlagHandler(createContext(ALLOWED_ADDRESS, { name: 'new-flag' }) as any)

    expect(response.status).toBe(201)
    expect(mockFeatureFlagsDb.create).toHaveBeenCalledWith(
      { name: 'new-flag', type: 'on-off', enabled: false, value: null, description: null },
      ALLOWED_ADDRESS
    )
    expect(response.body.ok).toBe(true)
    expect(response.body.data.name).toBe('new-flag')
  })

  it('should create the flag with the provided enabled and description', async () => {
    const response = await createFeatureFlagHandler(
      createContext(ALLOWED_ADDRESS, { name: 'new-flag', enabled: true, description: 'A new toggle' }) as any
    )

    expect(response.status).toBe(201)
    expect(mockFeatureFlagsDb.create).toHaveBeenCalledWith(
      { name: 'new-flag', type: 'on-off', enabled: true, value: null, description: 'A new toggle' },
      ALLOWED_ADDRESS
    )
  })

  it('should treat an empty description as null', async () => {
    await createFeatureFlagHandler(createContext(ALLOWED_ADDRESS, { name: 'new-flag', description: '   ' }) as any)

    expect(mockFeatureFlagsDb.create).toHaveBeenCalledWith(
      { name: 'new-flag', type: 'on-off', enabled: false, value: null, description: null },
      ALLOWED_ADDRESS
    )
  })

  describe('typed flags', () => {
    it('should return 400 for an unknown type', async () => {
      const response = await createFeatureFlagHandler(
        createContext(ALLOWED_ADDRESS, { name: 'new-flag', type: 'toggle' }) as any
      )

      expect(response.status).toBe(400)
      expect(response.body.error).toContain("'type' must be one of")
      expect(mockFeatureFlagsDb.create).not.toHaveBeenCalled()
    })

    it('should return 400 when an on-off flag is given a value', async () => {
      const response = await createFeatureFlagHandler(
        createContext(ALLOWED_ADDRESS, { name: 'new-flag', value: 'hello' }) as any
      )

      expect(response.status).toBe(400)
      expect(response.body.error).toContain("'value' is only valid for text and number flags")
    })

    it('should return 400 when a text/number flag is given enabled', async () => {
      const response = await createFeatureFlagHandler(
        createContext(ALLOWED_ADDRESS, { name: 'new-flag', type: 'number', value: 1, enabled: true }) as any
      )

      expect(response.status).toBe(400)
      expect(response.body.error).toContain("'enabled' is only valid for on-off flags")
    })

    it('should return 400 when a text flag is missing its value', async () => {
      const response = await createFeatureFlagHandler(
        createContext(ALLOWED_ADDRESS, { name: 'new-flag', type: 'text' }) as any
      )

      expect(response.status).toBe(400)
      expect(response.body.error).toContain("'value' must be a string")
    })

    it.each([['not-a-number'], ['1.2.3'], ['1e3'], [Infinity], [NaN], [true], [null]])(
      'should return 400 when a number flag gets invalid value %p',
      async (value) => {
        const response = await createFeatureFlagHandler(
          createContext(ALLOWED_ADDRESS, { name: 'sentry-sample-rate', type: 'number', value }) as any
        )

        expect(response.status).toBe(400)
        expect(response.body.error).toContain('plain decimal number')
        expect(mockFeatureFlagsDb.create).not.toHaveBeenCalled()
      }
    )

    it('should create a text flag with its value', async () => {
      const response = await createFeatureFlagHandler(
        createContext(ALLOWED_ADDRESS, { name: 'welcome-message', type: 'text', value: 'Hello there' }) as any
      )

      expect(response.status).toBe(201)
      expect(mockFeatureFlagsDb.create).toHaveBeenCalledWith(
        { name: 'welcome-message', type: 'text', enabled: false, value: 'Hello there', description: null },
        ALLOWED_ADDRESS
      )
    })

    it.each([
      [1, '1'],
      [0.1, '0.1'],
      ['0.10', '0.1'],
      ['1', '1'],
      [-2.5, '-2.5']
    ])('should create a number flag storing %p as the canonical string %p', async (value, stored) => {
      const response = await createFeatureFlagHandler(
        createContext(ALLOWED_ADDRESS, { name: 'sentry-sample-rate', type: 'number', value }) as any
      )

      expect(response.status).toBe(201)
      expect(mockFeatureFlagsDb.create).toHaveBeenCalledWith(
        { name: 'sentry-sample-rate', type: 'number', enabled: false, value: stored, description: null },
        ALLOWED_ADDRESS
      )
    })
  })

  it('should return 409 when the flag already exists', async () => {
    const uniqueViolation = Object.assign(new Error('duplicate key value'), { code: '23505' })
    mockFeatureFlagsDb.create.mockRejectedValue(uniqueViolation)

    const response = await createFeatureFlagHandler(createContext(ALLOWED_ADDRESS, { name: 'pulse' }) as any)

    expect(response.status).toBe(409)
    expect(response.body).toEqual({ ok: false, error: "Feature flag 'pulse' already exists" })
  })

  it('should return 500 on unexpected db errors', async () => {
    mockFeatureFlagsDb.create.mockRejectedValue(new Error('db down'))

    const response = await createFeatureFlagHandler(createContext(ALLOWED_ADDRESS, { name: 'new-flag' }) as any)

    expect(response.status).toBe(500)
    expect(response.body).toEqual({ ok: false, error: 'Internal server error' })
  })
})
