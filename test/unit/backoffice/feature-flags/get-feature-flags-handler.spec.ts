import { getBackofficeFeatureFlagsHandler } from '../../../../src/controllers/handlers/backoffice/feature-flags/get-feature-flags-handler'
import { createFeatureFlagsDbJestMockComponent, DEFAULT_TEST_FLAGS_DETAILED } from '../../../mocks/feature-flags-db-mock'
import { createLogsMockComponent } from '../../../mocks/logs-mock'
import { createConfigJestMockComponent } from '../../../mocks/config-mock'

describe('get-backoffice-feature-flags-handler', () => {
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

  function createContext(auth: string | undefined) {
    return {
      components: {
        featureFlagsDb: mockFeatureFlagsDb,
        logs: mockLogs,
        config: mockConfig
      },
      verification: auth ? { auth } : undefined
    }
  }

  it('should return 401 when the request is not authenticated', async () => {
    const response = await getBackofficeFeatureFlagsHandler(createContext(undefined) as any)

    expect(response.status).toBe(401)
    expect(response.body).toEqual({ ok: false, error: 'Unauthorized' })
  })

  it('should return 403 when the user is not in ALLOWED_USERS', async () => {
    const response = await getBackofficeFeatureFlagsHandler(createContext(TEST_ADDRESS) as any)

    expect(response.status).toBe(403)
    expect(response.body).toEqual({ ok: false, error: 'Forbidden: User not in allowed list' })
  })

  it('should return 200 with the detailed flags list', async () => {
    const response = await getBackofficeFeatureFlagsHandler(createContext(ALLOWED_ADDRESS) as any)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ ok: true, data: { flags: DEFAULT_TEST_FLAGS_DETAILED } })
  })

  it('should return 500 when the db fails', async () => {
    mockFeatureFlagsDb.getAllDetailed.mockRejectedValue(new Error('db down'))

    const response = await getBackofficeFeatureFlagsHandler(createContext(ALLOWED_ADDRESS) as any)

    expect(response.status).toBe(500)
    expect(response.body).toEqual({ ok: false, error: 'Internal server error' })
  })
})
