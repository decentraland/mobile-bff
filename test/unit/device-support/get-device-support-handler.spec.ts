import { getDeviceSupportHandler } from '../../../src/controllers/handlers/device-support/get-device-support-handler'
import { createDeviceSupportDbJestMockComponent } from '../../mocks/device-support-db-mock'
import { createLogsMockComponent } from '../../mocks/logs-mock'

describe('get-device-support-handler', () => {
  let mockDeviceSupportDb: ReturnType<typeof createDeviceSupportDbJestMockComponent>
  let mockLogs: ReturnType<typeof createLogsMockComponent>

  beforeEach(() => {
    mockDeviceSupportDb = createDeviceSupportDbJestMockComponent()
    mockLogs = createLogsMockComponent()
  })

  function createContext(soc?: string) {
    const url = soc ? `http://localhost/device-support?soc=${encodeURIComponent(soc)}` : 'http://localhost/device-support'
    return {
      components: {
        deviceSupportDb: mockDeviceSupportDb,
        logs: mockLogs
      },
      url: new URL(url)
    }
  }

  it('should return 400 when soc is missing', async () => {
    const response = await getDeviceSupportHandler(createContext() as any)

    expect(response.status).toBe(400)
    expect(response.body.error).toContain("'soc' is required")
    expect(mockDeviceSupportDb.getDecision).not.toHaveBeenCalled()
  })

  it('should return 400 when soc is empty', async () => {
    const response = await getDeviceSupportHandler(createContext('') as any)

    expect(response.status).toBe(400)
    expect(response.body.error).toContain("'soc' is required")
  })

  it('should return 400 when soc is longer than 64 characters', async () => {
    const response = await getDeviceSupportHandler(createContext('X'.repeat(65)) as any)

    expect(response.status).toBe(400)
    expect(response.body.error).toContain('64 characters')
  })

  it('should return the decision for a known soc', async () => {
    mockDeviceSupportDb.getDecision.mockResolvedValue('exclude')

    const response = await getDeviceSupportHandler(createContext('MT6765') as any)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ ok: true, data: { soc: 'MT6765', decision: 'exclude' } })
    expect(mockDeviceSupportDb.getDecision).toHaveBeenCalledWith('MT6765')
  })

  it('should query and echo back the normalized (trimmed, uppercased) soc, not the raw query value', async () => {
    mockDeviceSupportDb.getDecision.mockResolvedValue('below-minspec')

    const response = await getDeviceSupportHandler(createContext(' exynos 7420 ') as any)

    expect(mockDeviceSupportDb.getDecision).toHaveBeenCalledWith('EXYNOS 7420')
    expect(response.body.data.soc).toBe('EXYNOS 7420')
  })

  it("should default to 'keep' for an unknown soc", async () => {
    mockDeviceSupportDb.getDecision.mockResolvedValue('keep')

    const response = await getDeviceSupportHandler(createContext('SM8750') as any)

    expect(response.status).toBe(200)
    expect(response.body.data.decision).toBe('keep')
  })

  it('should return 500 on unexpected db errors', async () => {
    mockDeviceSupportDb.getDecision.mockRejectedValue(new Error('db down'))

    const response = await getDeviceSupportHandler(createContext('MT6765') as any)

    expect(response.status).toBe(500)
    expect(response.body).toEqual({ ok: false, error: 'Internal server error' })
  })
})
