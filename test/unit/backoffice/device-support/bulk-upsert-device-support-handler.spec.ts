import {
  bulkUpsertDeviceSupportHandler,
  MAX_BULK_ENTRIES
} from '../../../../src/controllers/handlers/backoffice/device-support/bulk-upsert-device-support-handler'
import { createDeviceSupportDbJestMockComponent } from '../../../mocks/device-support-db-mock'
import { createLogsMockComponent } from '../../../mocks/logs-mock'
import { createConfigJestMockComponent } from '../../../mocks/config-mock'

describe('bulk-upsert-device-support-handler', () => {
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

  function createContext(auth: string | undefined, body: any) {
    return {
      components: { deviceSupportDb: mockDeviceSupportDb, logs: mockLogs, config: mockConfig },
      verification: auth ? { auth } : undefined,
      request: { json: () => Promise.resolve(body) }
    }
  }

  it('should return 401 when the request is not authenticated', async () => {
    const response = await bulkUpsertDeviceSupportHandler(createContext(undefined, { entries: [] }) as any)

    expect(response.status).toBe(401)
  })

  it('should return 403 when the user is not in ALLOWED_USERS', async () => {
    const response = await bulkUpsertDeviceSupportHandler(createContext(TEST_ADDRESS, { entries: [] }) as any)

    expect(response.status).toBe(403)
  })

  it('should return 400 when entries is not an array', async () => {
    const response = await bulkUpsertDeviceSupportHandler(
      createContext(ALLOWED_ADDRESS, { entries: 'nope' }) as any
    )

    expect(response.status).toBe(400)
    expect(response.body.error).toContain("'entries' must be an array")
  })

  it('should return 400 when entries is empty', async () => {
    const response = await bulkUpsertDeviceSupportHandler(createContext(ALLOWED_ADDRESS, { entries: [] }) as any)

    expect(response.status).toBe(400)
    expect(response.body.error).toContain('must not be empty')
  })

  it('should return 400 when entries exceeds MAX_BULK_ENTRIES', async () => {
    const entries = Array.from({ length: MAX_BULK_ENTRIES + 1 }, (_, i) => ({
      soc: `SOC-${i}`,
      decision: 'exclude'
    }))

    const response = await bulkUpsertDeviceSupportHandler(createContext(ALLOWED_ADDRESS, { entries }) as any)

    expect(response.status).toBe(400)
    expect(response.body.error).toContain(`at most ${MAX_BULK_ENTRIES} items`)
    expect(mockDeviceSupportDb.bulkUpsert).not.toHaveBeenCalled()
  })

  it('should return 400 when an entry has an invalid soc', async () => {
    const response = await bulkUpsertDeviceSupportHandler(
      createContext(ALLOWED_ADDRESS, { entries: [{ soc: '', decision: 'exclude' }] }) as any
    )

    expect(response.status).toBe(400)
    expect(response.body.error).toContain('entries[0]')
    expect(mockDeviceSupportDb.bulkUpsert).not.toHaveBeenCalled()
  })

  it('should return 400 when an entry has an invalid decision', async () => {
    const response = await bulkUpsertDeviceSupportHandler(
      createContext(ALLOWED_ADDRESS, { entries: [{ soc: 'MT6765', decision: 'nope' }] }) as any
    )

    expect(response.status).toBe(400)
    expect(response.body.error).toContain('entries[0]')
    expect(mockDeviceSupportDb.bulkUpsert).not.toHaveBeenCalled()
  })

  it('should bulk upsert valid entries and return the count', async () => {
    const entries = [
      { soc: 'MT6765', decision: 'exclude' },
      { soc: 'SM4350', decision: 'below-minspec' }
    ]

    const response = await bulkUpsertDeviceSupportHandler(createContext(ALLOWED_ADDRESS, { entries }) as any)

    expect(response.status).toBe(200)
    expect(mockDeviceSupportDb.bulkUpsert).toHaveBeenCalledWith(entries, ALLOWED_ADDRESS)
    expect(response.body).toEqual({ ok: true, data: { count: 2 } })
  })

  it('should return 500 on unexpected db errors', async () => {
    mockDeviceSupportDb.bulkUpsert.mockRejectedValue(new Error('db down'))

    const response = await bulkUpsertDeviceSupportHandler(
      createContext(ALLOWED_ADDRESS, { entries: [{ soc: 'MT6765', decision: 'exclude' }] }) as any
    )

    expect(response.status).toBe(500)
  })
})
