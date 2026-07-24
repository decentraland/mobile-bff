import { deleteFeatureFlagHandler } from '../../../../src/controllers/handlers/backoffice/feature-flags/delete-feature-flag-handler'
import { createFeatureFlagsDbJestMockComponent } from '../../../mocks/feature-flags-db-mock'
import { createLogsMockComponent } from '../../../mocks/logs-mock'
import { createConfigJestMockComponent } from '../../../mocks/config-mock'

describe('delete-feature-flag-handler', () => {
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

  function createContext(auth: string | undefined, name: string) {
    return {
      components: {
        featureFlagsDb: mockFeatureFlagsDb,
        logs: mockLogs,
        config: mockConfig
      },
      verification: auth ? { auth } : undefined,
      params: { name }
    }
  }

  it('should return 401 when the request is not authenticated', async () => {
    const response = await deleteFeatureFlagHandler(createContext(undefined, 'pulse') as any)

    expect(response.status).toBe(401)
    expect(response.body).toEqual({ ok: false, error: 'Unauthorized' })
    expect(mockFeatureFlagsDb.delete).not.toHaveBeenCalled()
  })

  it('should return 403 when the user is not in ALLOWED_USERS', async () => {
    const response = await deleteFeatureFlagHandler(createContext(TEST_ADDRESS, 'pulse') as any)

    expect(response.status).toBe(403)
    expect(response.body).toEqual({ ok: false, error: 'Forbidden: User not in allowed list' })
    expect(mockFeatureFlagsDb.delete).not.toHaveBeenCalled()
  })

  it('should return 404 when the flag does not exist', async () => {
    mockFeatureFlagsDb.delete.mockResolvedValue(false)

    const response = await deleteFeatureFlagHandler(createContext(ALLOWED_ADDRESS, 'not-a-flag') as any)

    expect(response.status).toBe(404)
    expect(response.body).toEqual({ ok: false, error: "Feature flag 'not-a-flag' not found" })
  })

  it('should delete the flag and return 200', async () => {
    const response = await deleteFeatureFlagHandler(createContext(ALLOWED_ADDRESS, 'pulse') as any)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ ok: true, data: { name: 'pulse' } })
    expect(mockFeatureFlagsDb.delete).toHaveBeenCalledWith('pulse')
  })

  it('should log who deleted the flag', async () => {
    await deleteFeatureFlagHandler(createContext(ALLOWED_ADDRESS, 'pulse') as any)

    const logger = (mockLogs.getLogger as jest.Mock).mock.results[0].value
    expect(logger.info).toHaveBeenCalledWith(
      'Feature flag deleted',
      expect.objectContaining({ name: 'pulse', deletedBy: ALLOWED_ADDRESS })
    )
  })

  it('should return 500 when the db fails', async () => {
    mockFeatureFlagsDb.delete.mockRejectedValue(new Error('db down'))

    const response = await deleteFeatureFlagHandler(createContext(ALLOWED_ADDRESS, 'pulse') as any)

    expect(response.status).toBe(500)
    expect(response.body).toEqual({ ok: false, error: 'Internal server error' })
  })
})
