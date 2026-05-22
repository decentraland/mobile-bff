import { attestIosChallengeHandler } from '../../src/controllers/handlers/attest/challenge-handler'
import { createAppAttestJestMockComponent } from '../mocks/app-attest-mock'
import { createRateLimiterJestMockComponent } from '../mocks/rate-limiter-mock'
import { createLogsMockComponent } from '../mocks/logs-mock'

const emptyHeaders = { get: (_: string) => null }

describe('attest challenge handler', () => {
  function buildCtx() {
    const mockAppAttest = createAppAttestJestMockComponent()
    const mockRateLimiter = createRateLimiterJestMockComponent()
    const mockLogs = createLogsMockComponent()
    return {
      mockAppAttest,
      mockRateLimiter,
      context: {
        components: { appAttest: mockAppAttest, rateLimiter: mockRateLimiter, logs: mockLogs },
        request: { headers: emptyHeaders }
      }
    }
  }

  it('issues a challenge from the appAttest component', async () => {
    const { context, mockAppAttest } = buildCtx()
    mockAppAttest.issueChallenge.mockReturnValue({ challenge: 'ch1', expiresAt: '2026-01-01T00:00:00.000Z' })
    const res = await attestIosChallengeHandler(context as any)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ challenge: 'ch1', expires_at: '2026-01-01T00:00:00.000Z' })
  })

  it('returns 429 when rate limited, without minting a challenge', async () => {
    const { context, mockRateLimiter, mockAppAttest } = buildCtx()
    mockRateLimiter.check.mockReturnValue({ allowed: false, retryAfterSec: 13 })
    const res = await attestIosChallengeHandler(context as any)
    expect(res.status).toBe(429)
    expect((res.headers as any)?.['Retry-After']).toBe('13')
    expect(mockAppAttest.issueChallenge).not.toHaveBeenCalled()
  })
})
