import { signMessageHandler } from '../../src/controllers/handlers/wallets/sign-message-handler'
import { createThirdwebProxyJestMockComponent } from '../mocks/thirdweb-proxy-mock'
import { createAttestationSessionJestMockComponent } from '../mocks/attestation-session-mock'
import { createRateLimiterJestMockComponent } from '../mocks/rate-limiter-mock'
import { createLogsMockComponent } from '../mocks/logs-mock'

describe('sign-message-handler', () => {
  let mockProxy: ReturnType<typeof createThirdwebProxyJestMockComponent>
  let mockSession: ReturnType<typeof createAttestationSessionJestMockComponent>
  let mockRateLimiter: ReturnType<typeof createRateLimiterJestMockComponent>
  let mockLogs: ReturnType<typeof createLogsMockComponent>

  beforeEach(() => {
    mockProxy = createThirdwebProxyJestMockComponent()
    mockSession = createAttestationSessionJestMockComponent()
    mockRateLimiter = createRateLimiterJestMockComponent()
    mockLogs = createLogsMockComponent()
  })

  function createContext({
    authorization = 'Bearer test-jwt',
    sessionToken = 'session.token' as string | null,
    body = '{"chain":"polygon","message":"hello"}'
  }: { authorization?: string | null; sessionToken?: string | null; body?: string } = {}) {
    const headersMap = new Map<string, string>()
    if (authorization !== null) headersMap.set('authorization', authorization)
    if (sessionToken !== null) headersMap.set('x-attest-session', sessionToken)
    return {
      components: {
        thirdwebProxy: mockProxy,
        attestationSession: mockSession,
        rateLimiter: mockRateLimiter,
        logs: mockLogs
      },
      request: {
        headers: {
          get: (k: string) => headersMap.get(k.toLowerCase()) ?? null
        },
        arrayBuffer: async () => new TextEncoder().encode(body).buffer
      }
    }
  }

  describe('when rate limited', () => {
    it('returns 429 with Retry-After before touching session or proxy', async () => {
      mockRateLimiter.check.mockReturnValue({ allowed: false, retryAfterSec: 42 })
      const ctx = createContext()
      const res = await signMessageHandler(ctx as any)
      expect(res.status).toBe(429)
      expect((res.headers as any)?.['Retry-After']).toBe('42')
      expect(mockSession.verify).not.toHaveBeenCalled()
      expect(mockProxy.forwardSignMessage).not.toHaveBeenCalled()
    })
  })

  describe('when Authorization header is missing', () => {
    it('returns 401', async () => {
      const ctx = createContext({ authorization: null })
      const res = await signMessageHandler(ctx as any)
      expect(res.status).toBe(401)
      expect((res.body as any).error).toMatch(/Authorization: Bearer/i)
    })

    it('does not call the session verifier or proxy', async () => {
      const ctx = createContext({ authorization: null })
      await signMessageHandler(ctx as any)
      expect(mockSession.verify).not.toHaveBeenCalled()
      expect(mockProxy.forwardSignMessage).not.toHaveBeenCalled()
    })
  })

  describe('when Authorization is not a Bearer token', () => {
    it('returns 401', async () => {
      const ctx = createContext({ authorization: 'Basic abc' })
      const res = await signMessageHandler(ctx as any)
      expect(res.status).toBe(401)
    })
  })

  describe('when session token header is missing', () => {
    it('returns 401 with ATTESTATION_SESSION_MISSING', async () => {
      const ctx = createContext({ sessionToken: null })
      const res = await signMessageHandler(ctx as any)
      expect(res.status).toBe(401)
      expect((res.body as any).code).toBe('ATTESTATION_SESSION_MISSING')
      expect(mockProxy.forwardSignMessage).not.toHaveBeenCalled()
    })
  })

  describe('when the session token is invalid', () => {
    it('returns 401 with the verifier-supplied code', async () => {
      mockSession.verify.mockReturnValue({
        ok: false,
        code: 'ATTESTATION_SESSION_EXPIRED',
        error: 'token expired'
      })
      const ctx = createContext()
      const res = await signMessageHandler(ctx as any)
      expect(res.status).toBe(401)
      expect((res.body as any).code).toBe('ATTESTATION_SESSION_EXPIRED')
      expect((res.body as any).error).toBe('token expired')
    })

    it('does not call the proxy', async () => {
      mockSession.verify.mockReturnValue({
        ok: false,
        code: 'ATTESTATION_SESSION_BAD_SIGNATURE',
        error: 'tag does not match'
      })
      const ctx = createContext()
      await signMessageHandler(ctx as any)
      expect(mockProxy.forwardSignMessage).not.toHaveBeenCalled()
    })
  })

  describe('when session token is valid', () => {
    it('forwards the request to thirdweb proxy and returns its response', async () => {
      const ctx = createContext({ body: '{"foo":"bar"}' })
      const res = await signMessageHandler(ctx as any)
      expect(res.status).toBe(200)
      expect(Buffer.isBuffer(res.body)).toBe(true)
      expect((res.body as Buffer).toString('utf8')).toBe('{"signature":"0xdeadbeef"}')
      expect(mockProxy.forwardSignMessage).toHaveBeenCalledWith({
        authorization: 'Bearer test-jwt',
        rawBody: expect.any(Buffer)
      })
      const rawBody = mockProxy.forwardSignMessage.mock.calls[0][0].rawBody
      expect(rawBody.toString('utf8')).toBe('{"foo":"bar"}')
    })

    it('passes upstream content-type header through', async () => {
      const ctx = createContext()
      const res = await signMessageHandler(ctx as any)
      expect(res.headers).toEqual({ 'Content-Type': 'application/json' })
    })

    it('does NOT pass the body to the session verifier (no body binding)', async () => {
      const ctx = createContext({ body: '{"hello":"world"}' })
      await signMessageHandler(ctx as any)
      // The whole point of moving to a session token is that verification
      // depends only on the token itself, not on the request body.
      expect(mockSession.verify).toHaveBeenCalledWith('session.token')
    })
  })

  describe('when the proxy returns a non-2xx upstream status', () => {
    it('relays the status and body to the client', async () => {
      mockProxy.forwardSignMessage.mockResolvedValue({
        status: 400,
        contentType: 'application/json',
        body: Buffer.from('{"error":"bad chain"}', 'utf8')
      })
      const ctx = createContext()
      const res = await signMessageHandler(ctx as any)
      expect(res.status).toBe(400)
      expect((res.body as Buffer).toString('utf8')).toBe('{"error":"bad chain"}')
    })
  })
})
