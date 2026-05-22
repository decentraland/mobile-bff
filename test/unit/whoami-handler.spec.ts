import { whoamiHandler } from '../../src/controllers/handlers/wallets/whoami-handler'
import { createLogsMockComponent } from '../mocks/logs-mock'

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url')
}

function jwt(payload: Record<string, unknown>): string {
  return `header.${b64url(payload)}.sig`
}

describe('whoami-handler', () => {
  let mockLogs: ReturnType<typeof createLogsMockComponent>

  beforeEach(() => {
    mockLogs = createLogsMockComponent()
  })

  function createContext({ authorization }: { authorization?: string | null } = {}) {
    const headersMap = new Map<string, string>()
    if (authorization) headersMap.set('authorization', authorization)
    return {
      components: { logs: mockLogs },
      request: {
        headers: { get: (k: string) => headersMap.get(k.toLowerCase()) ?? null }
      }
    }
  }

  describe('Authorization header validation', () => {
    it('returns 401 when header is missing', async () => {
      const res = await whoamiHandler(createContext({ authorization: null }) as any)
      expect(res.status).toBe(401)
      expect((res.body as any).error).toMatch(/Authorization: Bearer/i)
    })

    it('returns 401 when scheme is not Bearer', async () => {
      const res = await whoamiHandler(createContext({ authorization: 'Basic abc' }) as any)
      expect(res.status).toBe(401)
    })

    it('accepts case-insensitive Bearer prefix', async () => {
      const exp = Math.floor(Date.now() / 1000) + 60
      const ctx = createContext({ authorization: `bearer ${jwt({ exp })}` })
      const res = await whoamiHandler(ctx as any)
      expect(res.status).toBe(200)
    })
  })

  describe('JWT shape', () => {
    it('returns 401 when token does not have three parts', async () => {
      const res = await whoamiHandler(createContext({ authorization: 'Bearer not.a.valid.jwt.too.many' }) as any)
      expect(res.status).toBe(401)
      expect((res.body as any).error).toMatch(/malformed JWT/i)
    })

    it('returns 401 when payload is not valid base64/JSON', async () => {
      const res = await whoamiHandler(createContext({ authorization: 'Bearer h.@@@.s' }) as any)
      expect(res.status).toBe(401)
      expect((res.body as any).error).toMatch(/malformed JWT payload/i)
    })

    it('returns 401 when payload decodes to a non-object', async () => {
      const ctx = createContext({ authorization: `Bearer header.${b64url('just-a-string')}.sig` })
      const res = await whoamiHandler(ctx as any)
      expect(res.status).toBe(401)
      expect((res.body as any).error).toMatch(/malformed JWT payload/i)
    })

    it('returns 401 when exp claim is missing', async () => {
      const ctx = createContext({ authorization: `Bearer ${jwt({ sub: '0xabc' })}` })
      const res = await whoamiHandler(ctx as any)
      expect(res.status).toBe(401)
      expect((res.body as any).error).toMatch(/exp/i)
    })

    it('returns 401 when exp claim is not a number', async () => {
      const ctx = createContext({ authorization: `Bearer ${jwt({ exp: 'soon' })}` })
      const res = await whoamiHandler(ctx as any)
      expect(res.status).toBe(401)
    })
  })

  describe('valid token', () => {
    it('returns active=true with exp/expiresAt/secondsRemaining for a future exp', async () => {
      const now = Math.floor(Date.now() / 1000)
      const exp = now + 3600
      const iat = now - 60
      const ctx = createContext({ authorization: `Bearer ${jwt({ sub: '0xabc', exp, iat })}` })
      const res = await whoamiHandler(ctx as any)
      expect(res.status).toBe(200)
      const body = res.body as any
      expect(body.active).toBe(true)
      expect(body.sub).toBe('0xabc')
      expect(body.exp).toBe(exp)
      expect(body.iat).toBe(iat)
      expect(body.expiresAt).toBe(new Date(exp * 1000).toISOString())
      expect(body.issuedAt).toBe(new Date(iat * 1000).toISOString())
      expect(body.secondsRemaining).toBeGreaterThan(3500)
      expect(body.secondsRemaining).toBeLessThanOrEqual(3600)
    })

    it('returns active=false with negative secondsRemaining when expired', async () => {
      const exp = Math.floor(Date.now() / 1000) - 3600
      const ctx = createContext({ authorization: `Bearer ${jwt({ sub: '0xabc', exp })}` })
      const res = await whoamiHandler(ctx as any)
      expect(res.status).toBe(200)
      const body = res.body as any
      expect(body.active).toBe(false)
      expect(body.secondsRemaining).toBeLessThan(0)
      expect(body.iat).toBeNull()
      expect(body.issuedAt).toBeNull()
    })

    it('returns sub=null when not a string', async () => {
      const exp = Math.floor(Date.now() / 1000) + 60
      const ctx = createContext({ authorization: `Bearer ${jwt({ sub: 42, exp })}` })
      const res = await whoamiHandler(ctx as any)
      expect(res.status).toBe(200)
      expect((res.body as any).sub).toBeNull()
    })
  })
})
