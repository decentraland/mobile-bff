// Per-endpoint rate-limit rules for the anonymous attestation + wallet flow.
// Tuned for a single mobile install in normal use: registration is one-shot
// per install, challenges are short-lived and consumed once, and check/sign
// fire roughly once per sign action on the client.
//
// Limits are intentionally conservative — a real user hitting these caps
// almost certainly means a buggy client retry loop, not legitimate traffic.

import { RateLimitRule } from '../adapters/rate-limiter'

export const RL_ATTEST_CHALLENGE: RateLimitRule = { windowMs: 60_000, max: 30 }
export const RL_ATTEST_REGISTER: RateLimitRule = { windowMs: 60_000, max: 10 }
export const RL_ATTEST_CHECK: RateLimitRule = { windowMs: 60_000, max: 60 }
export const RL_SIGN_MESSAGE: RateLimitRule = { windowMs: 60_000, max: 60 }
