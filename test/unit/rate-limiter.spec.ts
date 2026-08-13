import { createTestMetricsComponent } from '@dcl/metrics'

import {
  __resetFallbackWarningForTests,
  clientKeyFromHeaders,
  createRateLimiterComponent,
  FALLBACK_CLIENT_KEY,
  IRateLimiterComponent,
  RateLimitRule
} from '../../src/adapters/rate-limiter'
import { metricDeclarations } from '../../src/metrics'

// The rate-limiter reads Date.now() directly for both the bucket reset
// window and its 1-second sweep throttle. Mocking Date.now lets us
// exercise both without touching jest's fake timers.
function withNow(initial: number) {
  let now = initial
  const spy = jest.spyOn(Date, 'now').mockImplementation(() => now)
  return {
    set(next: number) {
      now = next
    },
    advance(ms: number) {
      now += ms
    },
    restore() {
      spy.mockRestore()
    }
  }
}

async function buildLimiter(): Promise<{
  limiter: IRateLimiterComponent
  metrics: ReturnType<typeof createTestMetricsComponent>
}> {
  const metrics = createTestMetricsComponent(metricDeclarations)
  const limiter = await createRateLimiterComponent({ metrics } as any)
  return { limiter, metrics }
}

describe('rate-limiter check()', () => {
  const RULE: RateLimitRule = { windowMs: 60_000, max: 3 }
  let clock: ReturnType<typeof withNow>

  beforeEach(() => {
    clock = withNow(1_000_000)
  })

  afterEach(() => {
    clock.restore()
  })

  it('allows up to max within the window then 429s with retryAfter', async () => {
    const { limiter } = await buildLimiter()
    for (let i = 0; i < 3; i++) {
      const r = limiter.check(RULE, 'k', 'rule-a')
      expect(r.allowed).toBe(true)
      expect(r.retryAfterSec).toBe(0)
    }
    const blocked = limiter.check(RULE, 'k', 'rule-a')
    expect(blocked.allowed).toBe(false)
    // 60s window, all calls at the same instant — retryAfter should
    // round up to the full window length.
    expect(blocked.retryAfterSec).toBe(60)
  })

  it('decreases retryAfter as time passes inside the same window', async () => {
    const { limiter } = await buildLimiter()
    for (let i = 0; i < 3; i++) limiter.check(RULE, 'k')
    clock.advance(45_000)
    const blocked = limiter.check(RULE, 'k')
    expect(blocked.allowed).toBe(false)
    // 15s remaining of the original 60s window.
    expect(blocked.retryAfterSec).toBe(15)
  })

  it('resets the bucket once the window has elapsed', async () => {
    const { limiter } = await buildLimiter()
    for (let i = 0; i < 3; i++) limiter.check(RULE, 'k')
    expect(limiter.check(RULE, 'k').allowed).toBe(false)
    clock.advance(60_000)
    // First call after window expiry must be allowed and reset the count.
    const r = limiter.check(RULE, 'k')
    expect(r.allowed).toBe(true)
    expect(r.retryAfterSec).toBe(0)
  })

  it('isolates buckets by key', async () => {
    const { limiter } = await buildLimiter()
    for (let i = 0; i < 3; i++) limiter.check(RULE, 'a')
    expect(limiter.check(RULE, 'a').allowed).toBe(false)
    // Different key — fresh quota.
    expect(limiter.check(RULE, 'b').allowed).toBe(true)
  })

  it('increments rate_limit_blocked_total with the ruleName label on 429', async () => {
    const { limiter, metrics } = await buildLimiter()
    for (let i = 0; i < 3; i++) limiter.check(RULE, 'k', 'sign-message')
    limiter.check(RULE, 'k', 'sign-message')
    const counter = await metrics.getValue('rate_limit_blocked_total')
    expect(
      counter.values.some((v: any) => v.labels.rule === 'sign-message' && v.value === 1)
    ).toBe(true)
  })

  it('falls back to "unknown" rule label when ruleName is not passed', async () => {
    const { limiter, metrics } = await buildLimiter()
    for (let i = 0; i < 3; i++) limiter.check(RULE, 'k')
    limiter.check(RULE, 'k')
    const counter = await metrics.getValue('rate_limit_blocked_total')
    expect(counter.values.some((v: any) => v.labels.rule === 'unknown' && v.value === 1)).toBe(true)
  })

  it('runs sweep at most once per second of wall time', async () => {
    const { limiter } = await buildLimiter()
    // Three keys with a short window — they all expire after we advance
    // past 100ms.
    const short: RateLimitRule = { windowMs: 100, max: 1 }
    limiter.check(short, 'a')
    limiter.check(short, 'b')
    limiter.check(short, 'c')
    // Move forward 200ms — buckets are expired but the sweep throttle has
    // not lapsed yet (it only runs once per 1000ms). A check at this point
    // should still allow new requests (because the per-key check sees the
    // expired bucket and resets it), but the *map size* will not shrink
    // until the sweep actually runs.
    clock.advance(200)
    // Hitting key 'd' here exercises the throttle: sweep is skipped, but
    // the call itself still works because the per-key branch handles
    // expired buckets directly.
    expect(limiter.check(short, 'd').allowed).toBe(true)
    // Advance past 1s so the next check triggers a sweep. Without throwing
    // — this is the smoke test: sweep walking the map should not break
    // active buckets.
    clock.advance(1_000)
    expect(limiter.check(short, 'e').allowed).toBe(true)
  })

  it('survives a flood of unique keys without throwing (MAX_BUCKETS overshoot path)', async () => {
    // We can't reach the 50k cap in a unit test without slowing it down,
    // but we exercise the same code path by inserting many keys, advancing
    // past the sweep throttle, and letting one more check trigger the
    // overshoot branch. The contract under test is "stays functional", not
    // a specific eviction order.
    const { limiter } = await buildLimiter()
    const wide: RateLimitRule = { windowMs: 60_000, max: 1 }
    for (let i = 0; i < 2_000; i++) limiter.check(wide, `flood:${i}`)
    clock.advance(1_500)
    // A check after the throttle window — should still work cleanly.
    const r = limiter.check(wide, 'flood:final')
    expect(r.allowed).toBe(true)
  })
})

describe('clientKeyFromHeaders', () => {
  function fakeHeaders(map: Record<string, string>): { get(name: string): string | null } {
    return {
      get(name: string) {
        return map[name.toLowerCase()] ?? null
      }
    }
  }

  beforeEach(() => {
    __resetFallbackWarningForTests()
  })

  it('prefers the leftmost x-forwarded-for hop', () => {
    const { key, isFallback } = clientKeyFromHeaders(
      fakeHeaders({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' })
    )
    expect(key).toBe('1.2.3.4')
    expect(isFallback).toBe(false)
  })

  it('falls back to x-real-ip when x-forwarded-for is absent', () => {
    const { key, isFallback } = clientKeyFromHeaders(fakeHeaders({ 'x-real-ip': '9.9.9.9' }))
    expect(key).toBe('9.9.9.9')
    expect(isFallback).toBe(false)
  })

  it('returns the FALLBACK_CLIENT_KEY sentinel when no proxy headers are present', () => {
    const { key, isFallback } = clientKeyFromHeaders(fakeHeaders({}))
    expect(key).toBe(FALLBACK_CLIENT_KEY)
    expect(isFallback).toBe(true)
  })

  it('warns at most once per process when the fallback path is hit', () => {
    const warn = jest.fn()
    const logger: any = { warn, info: jest.fn(), error: jest.fn(), debug: jest.fn(), log: jest.fn() }
    clientKeyFromHeaders(fakeHeaders({}), logger)
    clientKeyFromHeaders(fakeHeaders({}), logger)
    clientKeyFromHeaders(fakeHeaders({}), logger)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('does not warn when the IP could be resolved from a header', () => {
    const warn = jest.fn()
    const logger: any = { warn, info: jest.fn(), error: jest.fn(), debug: jest.fn(), log: jest.fn() }
    clientKeyFromHeaders(fakeHeaders({ 'x-forwarded-for': '1.2.3.4' }), logger)
    expect(warn).not.toHaveBeenCalled()
  })
})
