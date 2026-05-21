// In-memory per-IP token bucket. Each rule has its own window + max count,
// stored in a Map of `${rule}:${ip}` to bucket state. Single-process only —
// if this BFF ever scales horizontally and rate limiting becomes a security
// boundary rather than abuse mitigation, migrate to a shared Redis bucket.
//
// Sweeping: opportunistic GC on each check call. We bound the map size by
// dropping expired entries inline rather than running a timer.
//
// Why this lives outside the test-auth handler's local bucket: the
// attestation/wallet endpoints are anonymous and hit paid upstreams (Google
// Play Integrity, Thirdweb). Without rate limiting, a single script can
// exhaust the daily quota or push the bill up before the verifier rejects
// anything. test-auth's local bucket stays put — it only protects one
// endpoint and is only ever hit by Apple reviewers.

import { AppComponents } from '../types'

export type RateLimitRule = {
  windowMs: number
  max: number
}

export type RateLimitResult = {
  allowed: boolean
  // Seconds the caller should wait before retrying. 0 when allowed.
  retryAfterSec: number
}

export type IRateLimiterComponent = {
  // `ruleName` is reported as the `rule` label on the
  // rate_limit_blocked_total counter; pass a stable identifier per
  // endpoint so dashboards can attribute spikes.
  check(rule: RateLimitRule, key: string, ruleName?: string): RateLimitResult
}

type Bucket = {
  count: number
  resetAt: number
}

// Cap the total number of buckets to defend against a flood of unique IPs
// blowing up memory. When over cap, drop the oldest-reset entries first.
const MAX_BUCKETS = 50_000

export async function createRateLimiterComponent({
  metrics
}: Pick<AppComponents, 'metrics'>): Promise<IRateLimiterComponent> {
  const buckets = new Map<string, Bucket>()
  let lastSweep = 0

  function sweep(now: number): void {
    // Cheap-but-effective: only walk the map once per second of real time.
    // The check itself is O(1); the sweep is O(n) on the bucket count.
    if (now - lastSweep < 1000) return
    lastSweep = now
    for (const [k, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(k)
    }
    if (buckets.size > MAX_BUCKETS) {
      // Pathological case — too many distinct IPs in a single window. Drop
      // entries until we're back under the cap; whichever IPs lose state
      // just get an effective reset (which is fine — they're allowed-by-
      // default again, but that's no worse than no rate limit at all).
      const overshoot = buckets.size - MAX_BUCKETS
      let i = 0
      for (const k of buckets.keys()) {
        if (i++ >= overshoot) break
        buckets.delete(k)
      }
    }
  }

  function check(rule: RateLimitRule, key: string, ruleName = 'unknown'): RateLimitResult {
    const now = Date.now()
    sweep(now)
    const existing = buckets.get(key)
    if (!existing || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + rule.windowMs })
      return { allowed: true, retryAfterSec: 0 }
    }
    existing.count++
    if (existing.count > rule.max) {
      metrics.increment('rate_limit_blocked_total', { rule: ruleName })
      const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000))
      return { allowed: false, retryAfterSec }
    }
    return { allowed: true, retryAfterSec: 0 }
  }

  return { check }
}

// Extracts a stable per-caller key. Prefers the leftmost x-forwarded-for
// hop because that's the client the upstream proxy saw; falls back to a
// constant so misconfigured deployments still get *some* (degraded) rate
// limiting rather than none. Log the fallback path so it's visible.
export function clientKeyFromHeaders(headers: { get(name: string): string | null }): string {
  const xff = headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  const realIp = headers.get('x-real-ip')
  if (realIp) return realIp.trim()
  return 'unknown'
}
