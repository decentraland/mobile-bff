import { getBackofficeMeHandler } from '../../../src/controllers/handlers/backoffice/me-handler'
import { createConfigJestMockComponent } from '../../mocks/config-mock'

describe('me-handler', () => {
  const TEST_ADDRESS = '0x1234567890123456789012345678901234567890'
  const ALLOWED_ADDRESS = '0xABCDEF1234567890123456789012345678901234'

  let mockConfig: ReturnType<typeof createConfigJestMockComponent>

  beforeEach(() => {
    mockConfig = createConfigJestMockComponent({ ALLOWED_USERS: ALLOWED_ADDRESS })
  })

  function createContext(auth: string | undefined) {
    return {
      components: { config: mockConfig },
      verification: auth ? { auth } : undefined
    }
  }

  it('should return 401 when the request is not authenticated', async () => {
    const response = await getBackofficeMeHandler(createContext(undefined) as any)

    expect(response.status).toBe(401)
    expect(response.body).toEqual({ ok: false, error: 'Unauthorized' })
  })

  it('should return allowed: true when the signer is in ALLOWED_USERS', async () => {
    const response = await getBackofficeMeHandler(createContext(ALLOWED_ADDRESS) as any)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ ok: true, data: { address: ALLOWED_ADDRESS, allowed: true } })
  })

  it('should return 200 with allowed: false instead of 403 when the signer is not in ALLOWED_USERS', async () => {
    const response = await getBackofficeMeHandler(createContext(TEST_ADDRESS) as any)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ ok: true, data: { address: TEST_ADDRESS, allowed: false } })
  })

  it('should match the allow list case-insensitively', async () => {
    const response = await getBackofficeMeHandler(createContext(ALLOWED_ADDRESS.toLowerCase()) as any)

    expect(response.status).toBe(200)
    expect((response.body as any).data.allowed).toBe(true)
  })

  it('should return allowed: false when ALLOWED_USERS is not configured', async () => {
    mockConfig = createConfigJestMockComponent({})

    const response = await getBackofficeMeHandler(createContext(ALLOWED_ADDRESS) as any)

    expect(response.status).toBe(200)
    expect((response.body as any).data.allowed).toBe(false)
  })
})
