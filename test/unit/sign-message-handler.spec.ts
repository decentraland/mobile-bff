import { signMessageHandler } from '../../src/controllers/handlers/wallets/sign-message-handler'
import { createThirdwebProxyJestMockComponent } from '../mocks/thirdweb-proxy-mock'
import { createAttestationVerifierJestMockComponent } from '../mocks/attestation-verifier-mock'
import { createRateLimiterJestMockComponent } from '../mocks/rate-limiter-mock'
import { createLogsMockComponent } from '../mocks/logs-mock'

describe('sign-message-handler', () => {
  let mockProxy: ReturnType<typeof createThirdwebProxyJestMockComponent>
  let mockVerifier: ReturnType<typeof createAttestationVerifierJestMockComponent>
  let mockRateLimiter: ReturnType<typeof createRateLimiterJestMockComponent>
  let mockLogs: ReturnType<typeof createLogsMockComponent>

  beforeEach(() => {
    mockProxy = createThirdwebProxyJestMockComponent()
    mockVerifier = createAttestationVerifierJestMockComponent()
    mockRateLimiter = createRateLimiterJestMockComponent()
    mockLogs = createLogsMockComponent()
  })

  function createContext({
    authorization = 'Bearer test-jwt',
    body = '{"chain":"polygon","message":"hello"}'
  }: { authorization?: string | null; body?: string } = {}) {
    const headersMap = new Map<string, string>()
    if (authorization !== null) headersMap.set('authorization', authorization)
    return {
      components: {
        thirdwebProxy: mockProxy,
        attestationVerifier: mockVerifier,
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
    it('returns 429 with Retry-After before touching the verifier or proxy', async () => {
      mockRateLimiter.check.mockReturnValue({ allowed: false, retryAfterSec: 42 })
      const ctx = createContext()
      const res = await signMessageHandler(ctx as any)
      expect(res.status).toBe(429)
      expect((res.headers as any)?.['Retry-After']).toBe('42')
      expect(mockVerifier.verify).not.toHaveBeenCalled()
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

    it('does not call the verifier or proxy', async () => {
      const ctx = createContext({ authorization: null })
      await signMessageHandler(ctx as any)
      expect(mockVerifier.verify).not.toHaveBeenCalled()
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

  describe('when attestation fails', () => {
    beforeEach(() => {
      mockVerifier.verify.mockResolvedValue({
        ok: false,
        platform: 'ios',
        code: 'ATTESTATION_IOS_KEY_NOT_REGISTERED',
        error: 'key not registered',
        keyIdPrefix: 'abcd1234'
      })
    })

    it('returns 401 with attestation code in body', async () => {
      const ctx = createContext()
      const res = await signMessageHandler(ctx as any)
      expect(res.status).toBe(401)
      expect((res.body as any).code).toBe('ATTESTATION_IOS_KEY_NOT_REGISTERED')
      expect((res.body as any).platform).toBe('ios')
      expect((res.body as any).error).toBe('key not registered')
    })

    it('does not call the proxy', async () => {
      const ctx = createContext()
      await signMessageHandler(ctx as any)
      expect(mockProxy.forwardSignMessage).not.toHaveBeenCalled()
    })

    it('forwards platform-specific details when present', async () => {
      mockVerifier.verify.mockResolvedValue({
        ok: false,
        platform: 'android',
        code: 'ATTESTATION_ANDROID_VERDICT_FAILED',
        error: 'bad verdict',
        details: { missing: ['MEETS_STRONG_INTEGRITY'] }
      })
      const ctx = createContext()
      const res = await signMessageHandler(ctx as any)
      expect((res.body as any).details).toEqual({ missing: ['MEETS_STRONG_INTEGRITY'] })
    })
  })

  describe('when attestation passes', () => {
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

    it('passes the raw body to the attestation verifier', async () => {
      const ctx = createContext({ body: '{"hello":"world"}' })
      await signMessageHandler(ctx as any)
      const rawBody = mockVerifier.verify.mock.calls[0][0].rawBody
      expect(rawBody.toString('utf8')).toBe('{"hello":"world"}')
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
