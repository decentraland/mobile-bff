import { attestSessionHandler } from '../../src/controllers/handlers/attest/session-handler'
import { createAttestationVerifierJestMockComponent } from '../mocks/attestation-verifier-mock'
import { createAttestationSessionJestMockComponent } from '../mocks/attestation-session-mock'
import { createRateLimiterJestMockComponent } from '../mocks/rate-limiter-mock'
import { createLogsMockComponent } from '../mocks/logs-mock'

const emptyHeaders = { get: (_: string) => null }

describe('attest session handler', () => {
  function buildCtx({
    body = '{}',
    headers = {} as Record<string, string>,
    rateLimited = false
  }: { body?: string; headers?: Record<string, string>; rateLimited?: boolean } = {}) {
    const headersMap = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
    const mockVerifier = createAttestationVerifierJestMockComponent()
    const mockSession = createAttestationSessionJestMockComponent()
    const mockRateLimiter = createRateLimiterJestMockComponent()
    if (rateLimited) {
      mockRateLimiter.check.mockReturnValue({ allowed: false, retryAfterSec: 11 })
    }
    const mockLogs = createLogsMockComponent()
    return {
      mocks: { verifier: mockVerifier, session: mockSession, rateLimiter: mockRateLimiter, logs: mockLogs },
      context: {
        components: {
          attestationVerifier: mockVerifier,
          attestationSession: mockSession,
          rateLimiter: mockRateLimiter,
          logs: mockLogs
        },
        request: {
          headers: { get: (k: string) => headersMap.get(k.toLowerCase()) ?? null },
          arrayBuffer: async () => new TextEncoder().encode(body).buffer
        }
      }
    }
  }

  it('returns 429 with Retry-After when rate limited', async () => {
    const { context, mocks } = buildCtx({ rateLimited: true })
    const res = await attestSessionHandler(context as any)
    expect(res.status).toBe(429)
    expect((res.headers as any)?.['Retry-After']).toBe('11')
    expect(mocks.verifier.verify).not.toHaveBeenCalled()
    expect(mocks.session.issue).not.toHaveBeenCalled()
  })

  it('issues a token when attestation passes and forwards the platform', async () => {
    const { context, mocks } = buildCtx()
    mocks.verifier.verify.mockResolvedValue({ ok: true, platform: 'android', code: 'OK' })
    mocks.session.issue.mockReturnValue({ token: 'tok.xyz', expiresAt: 1_700_000_000_000 })
    const res = await attestSessionHandler(context as any)
    expect(res.status).toBe(200)
    expect((res.body as any).token).toBe('tok.xyz')
    expect((res.body as any).expires_at).toBe(new Date(1_700_000_000_000).toISOString())
    expect(mocks.session.issue).toHaveBeenCalledWith({ platform: 'android' })
  })

  it('passes the raw request body to the attestation verifier (body-bound at issuance)', async () => {
    const { context, mocks } = buildCtx({ body: '{"nonce":"abc"}' })
    await attestSessionHandler(context as any)
    const rawBody = mocks.verifier.verify.mock.calls[0][0].rawBody
    expect(rawBody.toString('utf8')).toBe('{"nonce":"abc"}')
  })

  it('returns 401 with the attestation code when verification fails', async () => {
    const { context, mocks } = buildCtx()
    mocks.verifier.verify.mockResolvedValue({
      ok: false,
      platform: 'ios',
      code: 'ATTESTATION_IOS_BAD_ASSERTION',
      error: 'aaguid mismatch',
      keyIdPrefix: 'aaaa'
    })
    const res = await attestSessionHandler(context as any)
    expect(res.status).toBe(401)
    expect((res.body as any).code).toBe('ATTESTATION_IOS_BAD_ASSERTION')
    expect((res.body as any).platform).toBe('ios')
    expect(mocks.session.issue).not.toHaveBeenCalled()
  })

  it('passes attestation-platform-specific details through on failure', async () => {
    const { context, mocks } = buildCtx()
    mocks.verifier.verify.mockResolvedValue({
      ok: false,
      platform: 'android',
      code: 'ATTESTATION_ANDROID_VERDICT_FAILED',
      error: 'bad verdict',
      details: { missing: ['MEETS_STRONG_INTEGRITY'] }
    })
    const res = await attestSessionHandler(context as any)
    expect(res.status).toBe(401)
    expect((res.body as any).details).toEqual({ missing: ['MEETS_STRONG_INTEGRITY'] })
  })
})
