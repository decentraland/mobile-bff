import { deleteDeviceSupportHandler } from '../../../../src/controllers/handlers/backoffice/device-support/delete-device-support-handler'
import { createDeviceSupportDbJestMockComponent } from '../../../mocks/device-support-db-mock'
import { createLogsMockComponent } from '../../../mocks/logs-mock'
import { createConfigJestMockComponent } from '../../../mocks/config-mock'

describe('delete-device-support-handler', () => {
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

  function createContext(auth: string | undefined, soc: string) {
    return {
      components: { deviceSupportDb: mockDeviceSupportDb, logs: mockLogs, config: mockConfig },
      verification: auth ? { auth } : undefined,
      params: { soc }
    }
  }

  it('should return 401 when the request is not authenticated', async () => {
    const response = await deleteDeviceSupportHandler(createContext(undefined, 'MT6765') as any)

    expect(response.status).toBe(401)
  })

  it('should return 403 when the user is not in ALLOWED_USERS', async () => {
    const response = await deleteDeviceSupportHandler(createContext(TEST_ADDRESS, 'MT6765') as any)

    expect(response.status).toBe(403)
  })

  it('should delete an existing entry and return 200', async () => {
    const response = await deleteDeviceSupportHandler(createContext(ALLOWED_ADDRESS, 'MT6765') as any)

    expect(response.status).toBe(200)
    expect(mockDeviceSupportDb.delete).toHaveBeenCalledWith('MT6765')
    expect(response.body).toEqual({ ok: true, data: { soc: 'MT6765' } })
  })

  it('should return 404 for a missing entry', async () => {
    mockDeviceSupportDb.delete.mockResolvedValue(false)

    const response = await deleteDeviceSupportHandler(createContext(ALLOWED_ADDRESS, 'UNKNOWN') as any)

    expect(response.status).toBe(404)
  })

  it('should return 500 on unexpected db errors', async () => {
    mockDeviceSupportDb.delete.mockRejectedValue(new Error('db down'))

    const response = await deleteDeviceSupportHandler(createContext(ALLOWED_ADDRESS, 'MT6765') as any)

    expect(response.status).toBe(500)
  })
})
