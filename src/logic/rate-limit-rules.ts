// Per-endpoint rate-limit rules for the anonymous attestation + wallet flow.
// Tuned for a single mobile install in normal use: registration is one-shot
// per install, challenges are short-lived and consumed once, and check/sign
// fire roughly once per sign action on the client.
//
// Limits are intentionally conservative — a real user hitting these caps
// almost certainly means a buggy client retry loop, not legitimate traffic.

import { RateLimitRule } from '../adapters/rate-limiter'

export const RL_ATTEST_CHALLENGE: RateLimitRule = { windowMs: 60_000, max: 30 }
// Session issuance burns one paid Play Integrity verdict per call on
// Android (and full cert-chain verification on iOS); same cap as challenge.
export const RL_ATTEST_SESSION: RateLimitRule = { windowMs: 60_000, max: 30 }
export const RL_SIGN_MESSAGE: RateLimitRule = { windowMs: 60_000, max: 60 }

// Divisor applied to a rule's `max` when the caller IP could not be
// resolved (no x-forwarded-for / x-real-ip). All such callers share a
// single bucket, so the effective cap is global — we tighten it so a
// misconfigured deployment degrades to "very few requests get through"
// instead of "the first N consume the full per-endpoint cap and the rest
// see 429". 10× tighter is arbitrary but matches the rough scale of
// per-IP vs shared traffic we expect in practice.
const FALLBACK_CAP_DIVISOR = 10

// Returns a rule with `max` lowered when the caller could not be
// attributed to a specific IP. Use when the rate-limit key came from the
// `isFallback: true` branch of `clientKeyFromHeaders`.
export function withFallbackCap(rule: RateLimitRule, isFallback: boolean): RateLimitRule {
  if (!isFallback) return rule
  return { windowMs: rule.windowMs, max: Math.max(1, Math.floor(rule.max / FALLBACK_CAP_DIVISOR)) }
}
