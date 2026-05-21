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

export type RegisterKeyResult = {
  // true on a fresh INSERT, false when ON CONFLICT updated an existing row.
  // Re-registration shouldn't happen in normal App Attest flow (attestation
  // is one-shot per key), so callers warn-log when this returns false.
  inserted: boolean
}

// Discriminated result of the CAS counter update. We need to distinguish
// "the row is gone" from "the row exists but its counter is already >=
// newCounter" — the first means the key was GC'd or never registered (the
// client should re-enrol) and the second is a genuine replay. Reporting
// both as a flat `false` led to misleading COUNTER_REPLAY codes in logs.
export type UpdateCounterResult =
  | { status: 'advanced' }
  | { status: 'counter_not_greater' }
  | { status: 'key_missing' }

export type IAttestationStateComponent = {
  issueChallenge(): Promise<{ challenge: string; expiresAt: string }>
  consumeChallenge(challenge: string): Promise<Buffer | null>
  registerKey(keyId: string, publicKeyPem: string): Promise<RegisterKeyResult>
  getRegisteredKey(keyId: string): Promise<RegisteredKey | null>
  updateKeyCounterIfGreater(keyId: string, newCounter: number): Promise<UpdateCounterResult>
}

export async function createAttestationStateComponent({
  pg
}: Pick<AppComponents, 'pg'>): Promise<IAttestationStateComponent> {
  async function issueChallenge(): Promise<{ challenge: string; expiresAt: string }> {
    const challengeBytes = crypto.randomBytes(32)
    const challenge = challengeBytes.toString('base64url')
    const expiresAtMs = Date.now() + CHALLENGE_TTL_MS
    const expiresAt = new Date(expiresAtMs)
    // Opportunistic GC: the issue path is anonymous and unauthenticated, so
    // we piggyback expired-row cleanup on every call rather than relying on
    // an external sweep. The expires_at index keeps this cheap.
    await pg.query(SQL`DELETE FROM attest_challenges WHERE expires_at < NOW()`)
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

  async function registerKey(keyId: string, publicKeyPem: string): Promise<RegisterKeyResult> {
    // ON CONFLICT DO UPDATE: if a client re-registers the same key_id
    // (shouldn't happen in normal flow — App Attest attestation is one-shot
    // per key — but harmless to overwrite), we reset the counter to 0 to
    // match the freshly-attested key.
    //
    // `xmax = 0` on the RETURNING row is the Postgres idiom for "this was
    // an INSERT, not an UPDATE": xmax is unset on a freshly-inserted tuple,
    // and ON CONFLICT DO UPDATE sets it. We surface that distinction so the
    // caller can warn-log overwrites — they can mean a client bug or, more
    // worryingly, an attacker resetting the counter on a key they control.
    const result = await pg.query<{ inserted: boolean }>(SQL`
      INSERT INTO attest_keys (key_id, public_key_pem, counter, last_used_at)
      VALUES (${keyId}, ${publicKeyPem}, 0, NOW())
      ON CONFLICT (key_id) DO UPDATE SET
        public_key_pem = EXCLUDED.public_key_pem,
        counter = 0,
        last_used_at = NOW()
      RETURNING (xmax = 0) AS inserted
    `)
    const inserted = result.rows[0]?.inserted ?? true
    return { inserted }
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

  async function updateKeyCounterIfGreater(keyId: string, newCounter: number): Promise<UpdateCounterResult> {
    // Atomic compare-and-swap: only advances if the stored counter is still
    // strictly below newCounter. Two concurrent requests verifying assertions
    // for the same key_id will both pass the signature check (assertions
    // were valid when issued) but only the one with the higher counter
    // wins.
    //
    // We need to distinguish three outcomes — advanced, lost-the-race
    // (replay), and row-vanished (key GC'd / not registered) — so we
    // RETURNING the post-update counter and then do a follow-up read when
    // the UPDATE matched no rows. The follow-up runs in the same connection
    // and the race window is small; a row deleted between UPDATE and SELECT
    // still gets reported as `key_missing`, which is the correct answer.
    const update = await pg.query<{ counter: string }>(SQL`
      UPDATE attest_keys
      SET counter = ${newCounter}, last_used_at = NOW()
      WHERE key_id = ${keyId} AND counter < ${newCounter}
      RETURNING counter
    `)
    if ((update.rowCount ?? 0) > 0) return { status: 'advanced' }
    const existing = await pg.query(SQL`SELECT 1 FROM attest_keys WHERE key_id = ${keyId}`)
    if (existing.rows.length === 0) return { status: 'key_missing' }
    return { status: 'counter_not_greater' }
  }

  return { issueChallenge, consumeChallenge, registerKey, getRegisteredKey, updateKeyCounterIfGreater }
}
