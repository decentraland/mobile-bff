import { getFeatureFlagsHandler } from '../../../src/controllers/handlers/feature-flags/get-feature-flags-handler'
import { createFeatureFlagsDbJestMockComponent } from '../../mocks/feature-flags-db-mock'
import { createLogsMockComponent } from '../../mocks/logs-mock'

describe('get-feature-flags-handler', () => {
  let mockFeatureFlagsDb: ReturnType<typeof createFeatureFlagsDbJestMockComponent>
  let mockLogs: ReturnType<typeof createLogsMockComponent>

  beforeEach(() => {
    mockFeatureFlagsDb = createFeatureFlagsDbJestMockComponent()
    mockLogs = createLogsMockComponent()
  })

  function createContext() {
    return {
      components: {
        featureFlagsDb: mockFeatureFlagsDb,
        logs: mockLogs
      }
    }
  }

  it('should return 200 with the flags map', async () => {
    mockFeatureFlagsDb.getAll.mockResolvedValue({ pulse: false, 'dual-channel': true })

    const response = await getFeatureFlagsHandler(createContext() as any)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ ok: true, data: { flags: { pulse: false, 'dual-channel': true } } })
  })

  it('should return 500 with the error envelope when the db fails', async () => {
    mockFeatureFlagsDb.getAll.mockRejectedValue(new Error('db down'))

    const response = await getFeatureFlagsHandler(createContext() as any)

    expect(response.status).toBe(500)
    expect(response.body).toEqual({ ok: false, error: 'Internal server error' })
  })

  it('should log the error when the db fails', async () => {
    mockFeatureFlagsDb.getAll.mockRejectedValue(new Error('db down'))

    await getFeatureFlagsHandler(createContext() as any)

    const logger = (mockLogs.getLogger as jest.Mock).mock.results[0].value
    expect(logger.error).toHaveBeenCalledWith('Error fetching feature flags', { error: 'db down' })
  })
})
