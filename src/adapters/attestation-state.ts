// Postgres-backed state for the attestation flow.
//
// Two pieces of state:
//   - attest_challenges: short-lived (5 min TTL), consumed once on register.
//   - attest_keys:       long-lived per install. Stores the public key, the
//                        last verified assertion counter, and last_used_at
//                        (used by a future cleanup job to purge keys idle
//                        for 30+ days).
//
// TODO(cleanup-30d): add a periodic job that deletes from attest_keys where
// last_used_at < NOW() - INTERVAL '30 days'. Keeps the table from growing
// monotonically as installs churn (uninstalled devices never tell us).

import crypto from 'node:crypto'
import SQL from 'sql-template-strings'

import { AppComponents } from '../types'

const CHALLENGE_TTL_MS = 5 * 60 * 1000

export type RegisteredKey = {
  publicKeyPem: string
  counter: number
}

export type IAttestationStateComponent = {
  issueChallenge(): Promise<{ challenge: string; expiresAt: string }>
  consumeChallenge(challenge: string): Promise<Buffer | null>
  registerKey(keyId: string, publicKeyPem: string): Promise<void>
  getRegisteredKey(keyId: string): Promise<RegisteredKey | null>
  // CAS update: only writes if newCounter > current counter, returns whether
  // the write actually happened. Returning `false` means a concurrent request
  // already advanced past `newCounter` — the caller should treat it as a
  // replay.
  updateKeyCounterIfGreater(keyId: string, newCounter: number): Promise<boolean>
}

export async function createAttestationStateComponent({
  pg
}: Pick<AppComponents, 'pg'>): Promise<IAttestationStateComponent> {
  async function issueChallenge(): Promise<{ challenge: string; expiresAt: string }> {
    const challengeBytes = crypto.randomBytes(32)
    const challenge = challengeBytes.toString('base64url')
    const expiresAtMs = Date.now() + CHALLENGE_TTL_MS
    const expiresAt = new Date(expiresAtMs)
    await pg.query(SQL`
      INSERT INTO attest_challenges (challenge, challenge_bytes, expires_at)
      VALUES (${challenge}, ${challengeBytes}, ${expiresAt})
    `)
    return { challenge, expiresAt: expiresAt.toISOString() }
  }

  async function consumeChallenge(challenge: string): Promise<Buffer | null> {
    // DELETE ... RETURNING is atomic: the same statement removes the row and
    // returns its contents, so a second consumer racing on the same
    // challenge gets nothing.
    const result = await pg.query<{ challenge_bytes: Buffer; expires_at: Date }>(SQL`
      DELETE FROM attest_challenges
      WHERE challenge = ${challenge}
      RETURNING challenge_bytes, expires_at
    `)
    if (result.rows.length === 0) return null
    const row = result.rows[0]
    if (row.expires_at.getTime() < Date.now()) return null
    return Buffer.from(row.challenge_bytes)
  }

  async function registerKey(keyId: string, publicKeyPem: string): Promise<void> {
    // ON CONFLICT DO UPDATE: if a client re-registers the same key_id
    // (shouldn't happen in normal flow — App Attest attestation is one-shot
    // per key — but harmless to overwrite), we reset the counter to 0 to
    // match the freshly-attested key.
    await pg.query(SQL`
      INSERT INTO attest_keys (key_id, public_key_pem, counter, last_used_at)
      VALUES (${keyId}, ${publicKeyPem}, 0, NOW())
      ON CONFLICT (key_id) DO UPDATE SET
        public_key_pem = EXCLUDED.public_key_pem,
        counter = 0,
        last_used_at = NOW()
    `)
  }

  async function getRegisteredKey(keyId: string): Promise<RegisteredKey | null> {
    const result = await pg.query<{ public_key_pem: string; counter: string }>(SQL`
      SELECT public_key_pem, counter
      FROM attest_keys
      WHERE key_id = ${keyId}
    `)
    if (result.rows.length === 0) return null
    const row = result.rows[0]
    // counter is BIGINT — pg returns it as string. App Attest counters are
    // bounded by uint32, so a Number cast is safe.
    return { publicKeyPem: row.public_key_pem, counter: Number(row.counter) }
  }

  async function updateKeyCounterIfGreater(keyId: string, newCounter: number): Promise<boolean> {
    // Atomic compare-and-swap: only advances if the stored counter is still
    // strictly below newCounter. Two concurrent requests verifying assertions
    // for the same key_id will both pass the signature check (assertions
    // were valid when issued) but only the one with the higher counter
    // wins; the other gets `false` here and is reported as a replay.
    const result = await pg.query(SQL`
      UPDATE attest_keys
      SET counter = ${newCounter}, last_used_at = NOW()
      WHERE key_id = ${keyId} AND counter < ${newCounter}
    `)
    return (result.rowCount ?? 0) > 0
  }

  return { issueChallenge, consumeChallenge, registerKey, getRegisteredKey, updateKeyCounterIfGreater }
}
