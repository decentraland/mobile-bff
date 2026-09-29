import { getBackofficeDeviceSupportHandler } from '../../../../src/controllers/handlers/backoffice/device-support/get-device-support-handler'
import { createDeviceSupportDbJestMockComponent, DEFAULT_TEST_ENTRIES } from '../../../mocks/device-support-db-mock'
import { createLogsMockComponent } from '../../../mocks/logs-mock'
import { createConfigJestMockComponent } from '../../../mocks/config-mock'

describe('get-backoffice-device-support-handler', () => {
  const TEST_ADDRESS = '0x1234567890123456789012345678901234567890'
  const ALLOWED_ADDRESS = '0xABCDEF1234567890123456789012345678901234'

  let mockDeviceSupportDb: ReturnType<typeof createDeviceSupportDbJestMockComponent>
  let mockLogs: ReturnType<typeof createLogsMockComponent>
  let mockConfig: ReturnType<typeof createConfigJestMockComponent>

  beforeEach(() => {
    mockDeviceSupportDb = createDeviceSupportDbJestMockComponent()
    mockLogs = createLogsMockComponent()
    mockConfig = createConfigJestMockComponent({ ALLOWED_USERS: ALLOWED_ADDRESS })
  })

  function createContext(auth: string | undefined) {
    return {
      components: { deviceSupportDb: mockDeviceSupportDb, logs: mockLogs, config: mockConfig },
      verification: auth ? { auth } : undefined
    }
  }

  it('should return 401 when the request is not authenticated', async () => {
    const response = await getBackofficeDeviceSupportHandler(createContext(undefined) as any)

    expect(response.status).toBe(401)
  })

  it('should return 403 when the user is not in ALLOWED_USERS', async () => {
    const response = await getBackofficeDeviceSupportHandler(createContext(TEST_ADDRESS) as any)

    expect(response.status).toBe(403)
  })

  it('should return all entries for an allowed user', async () => {
    const response = await getBackofficeDeviceSupportHandler(createContext(ALLOWED_ADDRESS) as any)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ ok: true, data: { entries: DEFAULT_TEST_ENTRIES } })
  })

  it('should return 500 on unexpected db errors', async () => {
    mockDeviceSupportDb.getAll.mockRejectedValue(new Error('db down'))

    const response = await getBackofficeDeviceSupportHandler(createContext(ALLOWED_ADDRESS) as any)

    expect(response.status).toBe(500)
  })
})
