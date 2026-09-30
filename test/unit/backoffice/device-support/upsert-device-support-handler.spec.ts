import { upsertDeviceSupportHandler } from '../../../../src/controllers/handlers/backoffice/device-support/upsert-device-support-handler'
import { createDeviceSupportDbJestMockComponent } from '../../../mocks/device-support-db-mock'
import { createLogsMockComponent } from '../../../mocks/logs-mock'
import { createConfigJestMockComponent } from '../../../mocks/config-mock'

describe('upsert-device-support-handler', () => {
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

  function createContext(auth: string | undefined, soc: string, body: any) {
    return {
      components: { deviceSupportDb: mockDeviceSupportDb, logs: mockLogs, config: mockConfig },
      verification: auth ? { auth } : undefined,
      params: { soc },
      request: { json: () => Promise.resolve(body) }
    }
  }

  it('should return 401 when the request is not authenticated', async () => {
    const response = await upsertDeviceSupportHandler(
      createContext(undefined, 'MT6765', { decision: 'exclude' }) as any
    )

    expect(response.status).toBe(401)
  })

  it('should return 403 when the user is not in ALLOWED_USERS', async () => {
    const response = await upsertDeviceSupportHandler(
      createContext(TEST_ADDRESS, 'MT6765', { decision: 'exclude' }) as any
    )

    expect(response.status).toBe(403)
  })

  it('should return 400 for an empty soc path param', async () => {
    const response = await upsertDeviceSupportHandler(createContext(ALLOWED_ADDRESS, '', { decision: 'exclude' }) as any)

    expect(response.status).toBe(400)
    expect(response.body.error).toContain("'soc' is required")
    expect(mockDeviceSupportDb.upsert).not.toHaveBeenCalled()
  })

  it.each([[undefined], ['unsupported'], [42], [null]])(
    'should return 400 for an invalid decision %p',
    async (decision) => {
      const response = await upsertDeviceSupportHandler(
        createContext(ALLOWED_ADDRESS, 'MT6765', { decision }) as any
      )

      expect(response.status).toBe(400)
      expect(response.body.error).toContain("'decision' must be one of")
      expect(mockDeviceSupportDb.upsert).not.toHaveBeenCalled()
    }
  )

  it.each(['exclude', 'below-minspec'])('should upsert a %s decision and return 200', async (decision) => {
    const response = await upsertDeviceSupportHandler(
      createContext(ALLOWED_ADDRESS, 'MT6765', { decision }) as any
    )

    expect(response.status).toBe(200)
    expect(mockDeviceSupportDb.upsert).toHaveBeenCalledWith('MT6765', decision, ALLOWED_ADDRESS)
    expect(response.body.ok).toBe(true)
  })

  it('should return 500 on unexpected db errors', async () => {
    mockDeviceSupportDb.upsert.mockRejectedValue(new Error('db down'))

    const response = await upsertDeviceSupportHandler(
      createContext(ALLOWED_ADDRESS, 'MT6765', { decision: 'exclude' }) as any
    )

    expect(response.status).toBe(500)
  })

  it('should return 400, not 500, for a malformed JSON body', async () => {
    const context = {
      components: { deviceSupportDb: mockDeviceSupportDb, logs: mockLogs, config: mockConfig },
      verification: { auth: ALLOWED_ADDRESS },
      params: { soc: 'MT6765' },
      request: { json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')) }
    }

    const response = await upsertDeviceSupportHandler(context as any)

    expect(response.status).toBe(400)
    expect(mockDeviceSupportDb.upsert).not.toHaveBeenCalled()
  })
})
