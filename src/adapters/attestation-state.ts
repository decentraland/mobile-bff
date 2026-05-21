// In-memory state for the attestation adapter. Process-local, lost on restart.
//
// TODO(persist): swap each Map for a durable store (Postgres via pg-component
// would fit the rest of the stack) before this runs on more than one replica.
// The current Maps mean every server restart forces every enrolled iOS install
// to re-register, and every issued challenge is instantly invalidated.

import crypto from 'node:crypto'

const CHALLENGE_TTL_MS = 5 * 60 * 1000

export type RegisteredKey = {
  publicKeyPem: string
  counter: number
  createdAtMs: number
}

export type IAttestationStateComponent = {
  issueChallenge(): { challenge: string; expiresAt: string }
  consumeChallenge(challenge: string): Buffer | null
  registerKey(keyId: string, publicKeyPem: string): void
  getRegisteredKey(keyId: string): RegisteredKey | null
  updateKeyCounter(keyId: string, newCounter: number): void
}

export async function createAttestationStateComponent(): Promise<IAttestationStateComponent> {
  // TODO(persist): challenge (base64url) -> { challengeBytes, expiresAtMs }
  const challenges = new Map<string, { challengeBytes: Buffer; expiresAtMs: number }>()
  // TODO(persist): keyId (base64url) -> RegisteredKey
  const registeredKeys = new Map<string, RegisteredKey>()

  function issueChallenge(): { challenge: string; expiresAt: string } {
    const challengeBytes = crypto.randomBytes(32)
    const challenge = challengeBytes.toString('base64url')
    const expiresAtMs = Date.now() + CHALLENGE_TTL_MS
    challenges.set(challenge, { challengeBytes, expiresAtMs })
    // Opportunistic GC so the Map doesn't grow forever.
    if (challenges.size > 1000) {
      const now = Date.now()
      for (const [k, v] of challenges) {
        if (v.expiresAtMs < now) challenges.delete(k)
      }
    }
    return { challenge, expiresAt: new Date(expiresAtMs).toISOString() }
  }

  function consumeChallenge(challenge: string): Buffer | null {
    const entry = challenges.get(challenge)
    if (!entry) return null
    challenges.delete(challenge)
    if (entry.expiresAtMs < Date.now()) return null
    return entry.challengeBytes
  }

  function registerKey(keyId: string, publicKeyPem: string): void {
    registeredKeys.set(keyId, { publicKeyPem, counter: 0, createdAtMs: Date.now() })
  }

  function getRegisteredKey(keyId: string): RegisteredKey | null {
    return registeredKeys.get(keyId) ?? null
  }

  function updateKeyCounter(keyId: string, newCounter: number): void {
    const entry = registeredKeys.get(keyId)
    if (!entry) return
    entry.counter = newCounter
  }

  return { issueChallenge, consumeChallenge, registerKey, getRegisteredKey, updateKeyCounter }
}
