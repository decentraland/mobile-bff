import { createAttestationStateComponent } from '../../src/adapters/attestation-state'

// Spec mocks the pg component's `query` interface. We assert on the calls
// in order, since this adapter intentionally chains multiple statements
// (e.g. opportunistic GC + insert in issueChallenge) and ordering is part
// of the contract.

type QueryShape = { text: string; values: any[] }

type ScriptedResult = { rows?: any[]; rowCount?: number }
type FakePg = {
  query: jest.Mock<Promise<ScriptedResult>, [QueryShape]>
  calls: () => QueryShape[]
}

function createFakePg(scripts: Array<ScriptedResult | ((q: QueryShape) => ScriptedResult)>): FakePg {
  let i = 0
  const captured: QueryShape[] = []
  const query = jest.fn(async (q: QueryShape): Promise<ScriptedResult> => {
    captured.push(q)
    const script = scripts[i++]
    if (script === undefined) return { rows: [], rowCount: 0 }
    return typeof script === 'function' ? script(q) : script
  })
  return { query, calls: () => captured } as any
}

async function buildState(scripts: Array<ScriptedResult | ((q: QueryShape) => ScriptedResult)>) {
  const pg = createFakePg(scripts)
  const state = await createAttestationStateComponent({ pg: pg as any } as any)
  return { state, pg }
}

describe('attestation-state', () => {
  describe('issueChallenge', () => {
    it('runs the opportunistic GC delete BEFORE inserting the new row', async () => {
      const { state, pg } = await buildState([
        { rows: [], rowCount: 0 }, // GC delete
        { rows: [], rowCount: 1 } // insert
      ])
      const out = await state.issueChallenge()
      const calls = pg.calls()
      expect(calls.length).toBe(2)
      expect(calls[0].text).toMatch(/DELETE FROM attest_challenges WHERE expires_at < NOW/i)
      expect(calls[1].text).toMatch(/INSERT INTO attest_challenges/i)
      expect(typeof out.challenge).toBe('string')
      expect(out.challenge.length).toBeGreaterThan(20)
      expect(new Date(out.expiresAt).getTime()).toBeGreaterThan(Date.now())
    })
  })

  describe('consumeChallenge', () => {
    it('returns the bytes when the row is fresh', async () => {
      const challengeBytes = Buffer.from('abc')
      const { state } = await buildState([
        { rows: [{ challenge_bytes: challengeBytes, expires_at: new Date(Date.now() + 10_000) }], rowCount: 1 }
      ])
      const out = await state.consumeChallenge('ch1')
      expect(out?.equals(challengeBytes)).toBe(true)
    })

    it('returns null when no row matched (already consumed or unknown)', async () => {
      const { state } = await buildState([{ rows: [], rowCount: 0 }])
      const out = await state.consumeChallenge('ch2')
      expect(out).toBeNull()
    })

    it('treats an expired-but-present row as null', async () => {
      const { state } = await buildState([
        { rows: [{ challenge_bytes: Buffer.from('zz'), expires_at: new Date(Date.now() - 1) }], rowCount: 1 }
      ])
      const out = await state.consumeChallenge('ch3')
      expect(out).toBeNull()
    })

    it('uses DELETE ... RETURNING in a single statement (atomic race-safe)', async () => {
      // Two concurrent consumers must not both see the same challenge. The
      // atomic DELETE ... RETURNING contract is what Postgres enforces; the
      // unit-test version of that is asserting the statement shape so a
      // future refactor that splits this into SELECT + DELETE gets caught.
      const { state, pg } = await buildState([
        { rows: [{ challenge_bytes: Buffer.from('a'), expires_at: new Date(Date.now() + 10_000) }], rowCount: 1 }
      ])
      await state.consumeChallenge('ch-x')
      const sql = pg.calls()[0].text
      expect(sql).toMatch(/DELETE FROM attest_challenges/i)
      expect(sql).toMatch(/RETURNING challenge_bytes, expires_at/i)
    })

    it('returns null on the second consumer of the same challenge (already-consumed path)', async () => {
      // Both calls share the same state component; the fake pg scripts the
      // first DELETE as returning the row and the second as returning none,
      // mirroring what Postgres would do under real concurrency.
      const challengeBytes = Buffer.from('once')
      const { state } = await buildState([
        { rows: [{ challenge_bytes: challengeBytes, expires_at: new Date(Date.now() + 10_000) }], rowCount: 1 },
        { rows: [], rowCount: 0 }
      ])
      const first = await state.consumeChallenge('ch-race')
      const second = await state.consumeChallenge('ch-race')
      expect(first?.equals(challengeBytes)).toBe(true)
      expect(second).toBeNull()
    })
  })

  describe('registerKey', () => {
    it('uses ON CONFLICT DO NOTHING so an existing row is never overwritten', async () => {
      const { state, pg } = await buildState([{ rows: [{ '?column?': 1 }], rowCount: 1 }])
      await state.registerKey('key-id', 'PEM')
      const sql = pg.calls()[0].text
      expect(sql).toMatch(/INSERT INTO attest_keys/i)
      expect(sql).toMatch(/ON CONFLICT \(key_id\) DO NOTHING/i)
      // Crucially the SQL must not reset the counter to 0 on conflict — that
      // was the replay-protection hole the DO NOTHING change closes.
      expect(sql).not.toMatch(/counter = 0/i)
    })

    it('returns { inserted: true } when the INSERT actually wrote a row', async () => {
      const { state } = await buildState([{ rows: [{ '?column?': 1 }], rowCount: 1 }])
      const out = await state.registerKey('key-id', '-----BEGIN PUBLIC KEY-----...')
      expect(out).toEqual({ inserted: true })
    })

    it('returns { inserted: false } when the row already existed (no overwrite)', async () => {
      const { state } = await buildState([{ rows: [], rowCount: 0 }])
      const out = await state.registerKey('key-id', 'PEM')
      expect(out).toEqual({ inserted: false })
    })
  })

  describe('updateKeyCounterIfGreater', () => {
    it('returns advanced when CAS hits a row with a strictly smaller counter', async () => {
      const { state, pg } = await buildState([
        { rows: [{ counter: '7' }], rowCount: 1 } // UPDATE matched
      ])
      const out = await state.updateKeyCounterIfGreater('k', 7)
      expect(out).toEqual({ status: 'advanced' })
      // Only the UPDATE statement should run on the happy path.
      expect(pg.calls().length).toBe(1)
    })

    it('returns counter_not_greater when the row exists but counter is already >= newCounter', async () => {
      const { state, pg } = await buildState([
        { rows: [], rowCount: 0 }, // UPDATE matched nothing
        { rows: [{ '?column?': 1 }], rowCount: 1 } // SELECT 1 finds the row
      ])
      const out = await state.updateKeyCounterIfGreater('k', 7)
      expect(out).toEqual({ status: 'counter_not_greater' })
      expect(pg.calls().length).toBe(2)
    })

    it('returns key_missing when the UPDATE missed AND the row is gone', async () => {
      const { state } = await buildState([
        { rows: [], rowCount: 0 }, // UPDATE matched nothing
        { rows: [], rowCount: 0 } // SELECT 1 finds nothing — row vanished
      ])
      const out = await state.updateKeyCounterIfGreater('k', 7)
      expect(out).toEqual({ status: 'key_missing' })
    })
  })

  describe('getRegisteredKey', () => {
    it('coerces the BIGINT counter (returned as string) to a Number', async () => {
      const { state } = await buildState([
        { rows: [{ public_key_pem: 'PEM', counter: '42' }], rowCount: 1 }
      ])
      const out = await state.getRegisteredKey('k')
      expect(out).toEqual({ publicKeyPem: 'PEM', counter: 42 })
    })

    it('returns null when the row is absent', async () => {
      const { state } = await buildState([{ rows: [], rowCount: 0 }])
      const out = await state.getRegisteredKey('k')
      expect(out).toBeNull()
    })
  })
})
