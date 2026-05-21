import { attestIosChallengeHandler } from '../../src/controllers/handlers/attest/challenge-handler'
import { attestIosRegisterHandler } from '../../src/controllers/handlers/attest/register-handler'
import { attestCheckHandler } from '../../src/controllers/handlers/attest/check-handler'
import { AppAttestError } from '../../src/adapters/app-attest'
import { createAttestationStateJestMockComponent } from '../mocks/attestation-state-mock'
import { createAppAttestJestMockComponent } from '../mocks/app-attest-mock'
import { createAttestationVerifierJestMockComponent } from '../mocks/attestation-verifier-mock'
import { createRateLimiterJestMockComponent } from '../mocks/rate-limiter-mock'
import { createLogsMockComponent } from '../mocks/logs-mock'

// Build an empty headers stub so handlers can extract a client key without
// blowing up.
const emptyHeaders = { get: (_: string) => null }

describe('attest handlers', () => {
  describe('challenge handler', () => {
    function buildCtx() {
      const mockState = createAttestationStateJestMockComponent()
      const mockRateLimiter = createRateLimiterJestMockComponent()
      return {
        mockState,
        mockRateLimiter,
        context: {
          components: { attestationState: mockState, rateLimiter: mockRateLimiter },
          request: { headers: emptyHeaders }
        }
      }
    }

    it('issues a challenge from the state component', async () => {
      const { context, mockState } = buildCtx()
      mockState.issueChallenge.mockResolvedValue({ challenge: 'ch1', expiresAt: '2026-01-01T00:00:00.000Z' })
      const res = await attestIosChallengeHandler(context as any)
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ challenge: 'ch1', expires_at: '2026-01-01T00:00:00.000Z' })
    })

    it('returns 429 when rate limited', async () => {
      const { context, mockRateLimiter, mockState } = buildCtx()
      mockRateLimiter.check.mockReturnValue({ allowed: false, retryAfterSec: 13 })
      const res = await attestIosChallengeHandler(context as any)
      expect(res.status).toBe(429)
      expect((res.headers as any)?.['Retry-After']).toBe('13')
      expect(mockState.issueChallenge).not.toHaveBeenCalled()
    })
  })

  describe('register handler', () => {
    function createContext(body: unknown, opts: {
      consumeReturns?: Buffer | null
      verifyThrows?: Error
      rateLimited?: boolean
    } = {}) {
      const mockState = createAttestationStateJestMockComponent()
      const mockAppAttest = createAppAttestJestMockComponent()
      const mockLogs = createLogsMockComponent()
      const mockRateLimiter = createRateLimiterJestMockComponent()
      if (opts.rateLimited) {
        mockRateLimiter.check.mockReturnValue({ allowed: false, retryAfterSec: 7 })
      }
      const consume = 'consumeReturns' in opts ? opts.consumeReturns! : Buffer.from('chal-bytes')
      mockState.consumeChallenge.mockResolvedValue(consume)
      if (opts.verifyThrows) {
        mockAppAttest.verifyRegistration.mockImplementation(() => {
          throw opts.verifyThrows
        })
      }
      return {
        mocks: { state: mockState, appAttest: mockAppAttest, logs: mockLogs, rateLimiter: mockRateLimiter },
        context: {
          components: {
            attestationState: mockState,
            appAttest: mockAppAttest,
            logs: mockLogs,
            rateLimiter: mockRateLimiter
          },
          request: { json: async () => body, headers: emptyHeaders }
        }
      }
    }

    it('returns 400 on invalid JSON', async () => {
      const mockState = createAttestationStateJestMockComponent()
      const mockAppAttest = createAppAttestJestMockComponent()
      const mockLogs = createLogsMockComponent()
      const mockRateLimiter = createRateLimiterJestMockComponent()
      const res = await attestIosRegisterHandler({
        components: {
          attestationState: mockState,
          appAttest: mockAppAttest,
          logs: mockLogs,
          rateLimiter: mockRateLimiter
        },
        request: {
          json: async () => {
            throw new Error('not json')
          },
          headers: emptyHeaders
        }
      } as any)
      expect(res.status).toBe(400)
      expect((res.body as any).error).toMatch(/invalid JSON/i)
    })

    it('returns 429 before parsing JSON when rate limited', async () => {
      const { context, mocks } = createContext(
        { key_id: 'k', attestation_object: 'a', challenge: 'c' },
        { rateLimited: true }
      )
      const res = await attestIosRegisterHandler(context as any)
      expect(res.status).toBe(429)
      expect((res.headers as any)?.['Retry-After']).toBe('7')
      expect(mocks.state.consumeChallenge).not.toHaveBeenCalled()
    })

    const invalidBodies: Array<{ name: string; body: Record<string, unknown> }> = [
      { name: 'missing key_id', body: { attestation_object: 'a', challenge: 'c' } },
      { name: 'missing attestation_object', body: { key_id: 'k', challenge: 'c' } },
      { name: 'missing challenge', body: { key_id: 'k', attestation_object: 'a' } },
      { name: 'non-string key_id', body: { key_id: 1, attestation_object: 'a', challenge: 'c' } }
    ]
    it.each(invalidBodies)('returns 400 for invalid body fields ($name)', async ({ body }) => {
      const { context } = createContext(body)
      const res = await attestIosRegisterHandler(context as any)
      expect(res.status).toBe(400)
      expect((res.body as any).error).toMatch(/required strings/)
    })

    it('returns 400 when the challenge is unknown or expired', async () => {
      const { context } = createContext(
        { key_id: 'k', attestation_object: 'a', challenge: 'c' },
        { consumeReturns: null }
      )
      const res = await attestIosRegisterHandler(context as any)
      expect(res.status).toBe(400)
      expect((res.body as any).error).toMatch(/challenge unknown or expired/)
    })

    it('returns 400 with the underlying error message on AppAttestError', async () => {
      const { context } = createContext(
        { key_id: 'k', attestation_object: 'a', challenge: 'c' },
        { verifyThrows: new AppAttestError('ATTESTATION_IOS_BAD_ASSERTION', 'aaguid mismatch') }
      )
      const res = await attestIosRegisterHandler(context as any)
      expect(res.status).toBe(400)
      expect((res.body as any).error).toBe('aaguid mismatch')
    })

    it('persists the leaf public key on success', async () => {
      const { context, mocks } = createContext({
        key_id: 'k',
        attestation_object: 'a',
        challenge: 'c'
      })
      mocks.appAttest.verifyRegistration.mockReturnValue({ publicKeyPem: 'PEM' })
      const res = await attestIosRegisterHandler(context as any)
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ registered: true, key_id_prefix: 'k' })
      expect(mocks.state.registerKey).toHaveBeenCalledWith('k', 'PEM')
    })

    it('returns key_id_prefix and warn-logs when an existing row is overwritten', async () => {
      const { context, mocks } = createContext({
        key_id: 'key-id-1234567890',
        attestation_object: 'a',
        challenge: 'c'
      })
      mocks.appAttest.verifyRegistration.mockReturnValue({ publicKeyPem: 'PEM' })
      mocks.state.registerKey.mockResolvedValue({ inserted: false })
      const warn = jest.fn()
      ;(mocks.logs.getLogger as jest.Mock).mockReturnValue({
        info: jest.fn(),
        warn,
        error: jest.fn(),
        debug: jest.fn(),
        log: jest.fn()
      })
      const res = await attestIosRegisterHandler(context as any)
      expect(res.status).toBe(200)
      expect((res.body as any).key_id_prefix).toBe('key-id-1')
      expect(warn).toHaveBeenCalledWith(
        'ios key re-registered, counter reset',
        expect.objectContaining({ key_id_prefix: 'key-id-1' })
      )
    })

    it('wraps unexpected (non-AppAttestError) failures', async () => {
      const { context } = createContext(
        { key_id: 'k', attestation_object: 'a', challenge: 'c' },
        { verifyThrows: new Error('boom') }
      )
      const res = await attestIosRegisterHandler(context as any)
      expect(res.status).toBe(400)
      expect((res.body as any).error).toMatch(/unexpected: boom/)
    })
  })

  describe('check handler', () => {
    function createContext(body = '{}', headers: Record<string, string> = {}, opts: { rateLimited?: boolean } = {}) {
      const headersMap = new Map(Object.entries(headers))
      const mockVerifier = createAttestationVerifierJestMockComponent()
      const mockRateLimiter = createRateLimiterJestMockComponent()
      const mockLogs = createLogsMockComponent()
      if (opts.rateLimited) {
        mockRateLimiter.check.mockReturnValue({ allowed: false, retryAfterSec: 9 })
      }
      return {
        mockVerifier,
        mockRateLimiter,
        context: {
          components: { attestationVerifier: mockVerifier, rateLimiter: mockRateLimiter, logs: mockLogs },
          request: {
            headers: { get: (k: string) => headersMap.get(k) ?? null },
            arrayBuffer: async () => new TextEncoder().encode(body).buffer
          }
        }
      }
    }

    it('returns 429 when rate limited, without invoking the verifier', async () => {
      const { context, mockVerifier } = createContext('{}', {}, { rateLimited: true })
      const res = await attestCheckHandler(context as any)
      expect(res.status).toBe(429)
      expect((res.headers as any)?.['Retry-After']).toBe('9')
      expect(mockVerifier.verify).not.toHaveBeenCalled()
    })

    it('always returns 200 even on failure', async () => {
      const { context, mockVerifier } = createContext()
      mockVerifier.verify.mockResolvedValue({
        ok: false,
        platform: 'ios',
        code: 'ATTESTATION_IOS_MISSING_HEADERS',
        error: 'missing'
      })
      const res = await attestCheckHandler(context as any)
      expect(res.status).toBe(200)
      expect((res.body as any).ok).toBe(false)
      expect((res.body as any).code).toBe('ATTESTATION_IOS_MISSING_HEADERS')
    })

    it('includes verdicts on android success', async () => {
      const { context, mockVerifier } = createContext()
      mockVerifier.verify.mockResolvedValue({
        ok: true,
        platform: 'android',
        code: 'OK',
        verdicts: ['MEETS_STRONG_INTEGRITY']
      })
      const res = await attestCheckHandler(context as any)
      expect((res.body as any).verdicts).toEqual(['MEETS_STRONG_INTEGRITY'])
    })

    it('includes elapsed_ms', async () => {
      const { context } = createContext()
      const res = await attestCheckHandler(context as any)
      expect(typeof (res.body as any).elapsed_ms).toBe('number')
    })

    it('forwards the raw body to the verifier', async () => {
      const { context, mockVerifier } = createContext('{"foo":1}')
      await attestCheckHandler(context as any)
      const rawBody = mockVerifier.verify.mock.calls[0][0].rawBody
      expect(rawBody.toString('utf8')).toBe('{"foo":1}')
    })
  })
})
