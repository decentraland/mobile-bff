import { updateFeatureFlagHandler } from '../../../../src/controllers/handlers/backoffice/feature-flags/update-feature-flag-handler'
import { createFeatureFlagsDbJestMockComponent, createTestFeatureFlag } from '../../../mocks/feature-flags-db-mock'
import { createLogsMockComponent } from '../../../mocks/logs-mock'
import { createConfigJestMockComponent } from '../../../mocks/config-mock'

describe('update-feature-flag-handler', () => {
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

  function createContext(auth: string | undefined, name: string, body: any) {
    return {
      components: {
        featureFlagsDb: mockFeatureFlagsDb,
        logs: mockLogs,
        config: mockConfig
      },
      verification: auth ? { auth } : undefined,
      params: { name },
      request: {
        json: () => Promise.resolve(body)
      }
    }
  }

  it('should return 401 when the request is not authenticated', async () => {
    const response = await updateFeatureFlagHandler(createContext(undefined, 'pulse', { enabled: true }) as any)

    expect(response.status).toBe(401)
    expect(response.body).toEqual({ ok: false, error: 'Unauthorized' })
  })

  it('should return 403 when the user is not in ALLOWED_USERS', async () => {
    const response = await updateFeatureFlagHandler(createContext(TEST_ADDRESS, 'pulse', { enabled: true }) as any)

    expect(response.status).toBe(403)
    expect(response.body).toEqual({ ok: false, error: 'Forbidden: User not in allowed list' })
  })

  it('should return 400 when neither enabled nor description is provided', async () => {
    const response = await updateFeatureFlagHandler(createContext(ALLOWED_ADDRESS, 'pulse', {}) as any)

    expect(response.status).toBe(400)
    expect(response.body).toEqual({ ok: false, error: "At least one of 'enabled' or 'description' is required" })
    expect(mockFeatureFlagsDb.update).not.toHaveBeenCalled()
  })

  it('should return 400 when enabled is not a boolean', async () => {
    const response = await updateFeatureFlagHandler(createContext(ALLOWED_ADDRESS, 'pulse', { enabled: 1 }) as any)

    expect(response.status).toBe(400)
    expect(response.body).toEqual({ ok: false, error: "'enabled' must be a boolean" })
  })

  it('should return 400 when description is not a string or null', async () => {
    const response = await updateFeatureFlagHandler(
      createContext(ALLOWED_ADDRESS, 'pulse', { description: 42 }) as any
    )

    expect(response.status).toBe(400)
    expect(response.body.error).toContain("'description' must be a string")
  })

  it('should return 400 when description is longer than 500 characters', async () => {
    const response = await updateFeatureFlagHandler(
      createContext(ALLOWED_ADDRESS, 'pulse', { description: 'x'.repeat(501) }) as any
    )

    expect(response.status).toBe(400)
    expect(response.body.error).toContain('500 characters')
  })

  it('should return 404 when the flag does not exist', async () => {
    mockFeatureFlagsDb.update.mockResolvedValue(null)

    const response = await updateFeatureFlagHandler(
      createContext(ALLOWED_ADDRESS, 'not-a-flag', { enabled: true }) as any
    )

    expect(response.status).toBe(404)
    expect(response.body).toEqual({ ok: false, error: "Feature flag 'not-a-flag' not found" })
  })

  it('should update the enabled state and return the updated flag', async () => {
    const response = await updateFeatureFlagHandler(createContext(ALLOWED_ADDRESS, 'pulse', { enabled: true }) as any)

    expect(response.status).toBe(200)
    expect(mockFeatureFlagsDb.update).toHaveBeenCalledWith('pulse', { enabled: true }, ALLOWED_ADDRESS)
    expect(response.body.ok).toBe(true)
    expect(response.body.data.enabled).toBe(true)
  })

  it('should update the description without touching enabled', async () => {
    await updateFeatureFlagHandler(createContext(ALLOWED_ADDRESS, 'pulse', { description: 'New words' }) as any)

    expect(mockFeatureFlagsDb.update).toHaveBeenCalledWith('pulse', { description: 'New words' }, ALLOWED_ADDRESS)
  })

  it('should allow clearing the description with null', async () => {
    await updateFeatureFlagHandler(createContext(ALLOWED_ADDRESS, 'pulse', { description: null }) as any)

    expect(mockFeatureFlagsDb.update).toHaveBeenCalledWith('pulse', { description: null }, ALLOWED_ADDRESS)
  })

  it('should log who updated the flag', async () => {
    await updateFeatureFlagHandler(createContext(ALLOWED_ADDRESS, 'pulse', { enabled: true }) as any)

    const logger = (mockLogs.getLogger as jest.Mock).mock.results[0].value
    expect(logger.info).toHaveBeenCalledWith(
      'Feature flag updated',
      expect.objectContaining({ name: 'pulse', updatedBy: ALLOWED_ADDRESS })
    )
  })

  it('should return 500 when the db fails', async () => {
    mockFeatureFlagsDb.update.mockRejectedValue(new Error('db down'))

    const response = await updateFeatureFlagHandler(createContext(ALLOWED_ADDRESS, 'pulse', { enabled: true }) as any)

    expect(response.status).toBe(500)
    expect(response.body).toEqual({ ok: false, error: 'Internal server error' })
  })

  it('should pass through the updated flag from the db', async () => {
    const updated = createTestFeatureFlag({ name: 'pulse', enabled: true, updatedBy: ALLOWED_ADDRESS })
    mockFeatureFlagsDb.update.mockResolvedValue(updated)

    const response = await updateFeatureFlagHandler(createContext(ALLOWED_ADDRESS, 'pulse', { enabled: true }) as any)

    expect(response.body).toEqual({ ok: true, data: updated })
  })
})
