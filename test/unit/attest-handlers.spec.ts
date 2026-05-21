import { attestIosChallengeHandler } from '../../src/controllers/handlers/attest/challenge-handler'
import { attestIosRegisterHandler } from '../../src/controllers/handlers/attest/register-handler'
import { attestCheckHandler } from '../../src/controllers/handlers/attest/check-handler'
import { AppAttestError } from '../../src/adapters/app-attest'
import { createAttestationStateJestMockComponent } from '../mocks/attestation-state-mock'
import { createAppAttestJestMockComponent } from '../mocks/app-attest-mock'
import { createAttestationVerifierJestMockComponent } from '../mocks/attestation-verifier-mock'
import { createLogsMockComponent } from '../mocks/logs-mock'

describe('attest handlers', () => {
  describe('challenge handler', () => {
    it('issues a challenge from the state component', async () => {
      const mockState = createAttestationStateJestMockComponent()
      mockState.issueChallenge.mockResolvedValue({ challenge: 'ch1', expiresAt: '2026-01-01T00:00:00.000Z' })
      const res = await attestIosChallengeHandler({
        components: { attestationState: mockState }
      } as any)
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ challenge: 'ch1', expires_at: '2026-01-01T00:00:00.000Z' })
    })
  })

  describe('register handler', () => {
    function createContext(body: unknown, opts: {
      consumeReturns?: Buffer | null
      verifyThrows?: Error
    } = {}) {
      const mockState = createAttestationStateJestMockComponent()
      const mockAppAttest = createAppAttestJestMockComponent()
      const mockLogs = createLogsMockComponent()
      const consume = 'consumeReturns' in opts ? opts.consumeReturns! : Buffer.from('chal-bytes')
      mockState.consumeChallenge.mockResolvedValue(consume)
      if (opts.verifyThrows) {
        mockAppAttest.verifyRegistration.mockImplementation(() => {
          throw opts.verifyThrows
        })
      }
      return {
        mocks: { state: mockState, appAttest: mockAppAttest, logs: mockLogs },
        context: {
          components: { attestationState: mockState, appAttest: mockAppAttest, logs: mockLogs },
          request: { json: async () => body }
        }
      }
    }

    it('returns 400 on invalid JSON', async () => {
      const mockState = createAttestationStateJestMockComponent()
      const mockAppAttest = createAppAttestJestMockComponent()
      const mockLogs = createLogsMockComponent()
      const res = await attestIosRegisterHandler({
        components: { attestationState: mockState, appAttest: mockAppAttest, logs: mockLogs },
        request: {
          json: async () => {
            throw new Error('not json')
          }
        }
      } as any)
      expect(res.status).toBe(400)
      expect((res.body as any).error).toMatch(/invalid JSON/i)
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
        { verifyThrows: new AppAttestError('aaguid mismatch') }
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
      expect(res.body).toEqual({ registered: true })
      expect(mocks.state.registerKey).toHaveBeenCalledWith('k', 'PEM')
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
    function createContext(body = '{}', headers: Record<string, string> = {}) {
      const headersMap = new Map(Object.entries(headers))
      const mockVerifier = createAttestationVerifierJestMockComponent()
      return {
        mockVerifier,
        context: {
          components: { attestationVerifier: mockVerifier },
          request: {
            headers: { get: (k: string) => headersMap.get(k) ?? null },
            arrayBuffer: async () => new TextEncoder().encode(body).buffer
          }
        }
      }
    }

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
