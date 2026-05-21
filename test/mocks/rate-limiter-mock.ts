import { IRateLimiterComponent } from '../../src/adapters/rate-limiter'

export function createRateLimiterJestMockComponent(
  overrides: Partial<jest.Mocked<IRateLimiterComponent>> = {}
): jest.Mocked<IRateLimiterComponent> {
  return {
    check: jest.fn().mockReturnValue({ allowed: true, retryAfterSec: 0 }),
    ...overrides
  }
}
