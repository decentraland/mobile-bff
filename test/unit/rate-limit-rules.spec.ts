import { RateLimitRule } from '../../src/adapters/rate-limiter'
import { withFallbackCap } from '../../src/logic/rate-limit-rules'

describe('withFallbackCap', () => {
  const RULE: RateLimitRule = { windowMs: 60_000, max: 60 }

  it('returns the rule unchanged when isFallback is false', () => {
    expect(withFallbackCap(RULE, false)).toBe(RULE)
  })

  it('divides the max by 10 when isFallback is true', () => {
    const tightened = withFallbackCap(RULE, true)
    expect(tightened.max).toBe(6)
    expect(tightened.windowMs).toBe(60_000)
  })

  it('clamps the divided max to a minimum of 1', () => {
    // A small base max would otherwise be floored to 0, which would
    // effectively deny all fallback requests including the first one.
    const small: RateLimitRule = { windowMs: 60_000, max: 5 }
    const tightened = withFallbackCap(small, true)
    expect(tightened.max).toBe(1)
  })
})
