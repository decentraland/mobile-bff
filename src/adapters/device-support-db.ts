import SQL from 'sql-template-strings'
import { AppComponents } from '../types'
import { Decision, PublicDecision, normalizeSoc } from '../logic/device-support'

export type DeviceSupportEntry = {
  soc: string
  decision: Decision
  updatedAt: string
  updatedBy: string | null
}

export type BulkUpsertEntry = {
  soc: string
  decision: Decision
}

export type IDeviceSupportDbComponent = {
  getDecision(soc: string): Promise<PublicDecision>
  getAll(): Promise<DeviceSupportEntry[]>
  upsert(soc: string, decision: Decision, updatedBy: string): Promise<DeviceSupportEntry>
  bulkUpsert(entries: BulkUpsertEntry[], updatedBy: string): Promise<number>
  delete(soc: string): Promise<boolean>
}

type DeviceSupportRow = {
  soc_model: string
  decision: Decision
  updated_at: Date
  updated_by: string | null
}

function toEntry(row: DeviceSupportRow): DeviceSupportEntry {
  return {
    soc: row.soc_model,
    decision: row.decision,
    updatedAt: new Date(row.updated_at).toISOString(),
    updatedBy: row.updated_by
  }
}

export async function createDeviceSupportDbComponent({
  pg,
  metrics
}: Pick<AppComponents, 'pg' | 'metrics'>): Promise<IDeviceSupportDbComponent> {
  // soc_key (a generated column: REPLACE(soc_model, ' ', ''), see the migration) makes lookups
  // whitespace-insensitive, so a client-reported value that differs from the stored one only by a
  // missing/extra space (e.g. "EXYNOS7420" vs the seeded "EXYNOS 7420" -- 18 of the 320 seed rows
  // have an internal space) still matches. soc_model keeps its natural spacing for backoffice
  // readability; soc_key's unique index (which upsert/bulkUpsert's ON CONFLICT also targets)
  // guarantees at most one row can ever match a given key, so there's no ordering ambiguity in
  // rows[0] below.
  //
  // device_support_lookup_total{found} is the only production signal that a client's SoC string
  // isn't reaching this table in the form it's stored in -- an absent row is indistinguishable
  // from a genuinely fine chip otherwise (both resolve to 'keep'), so a rising found=false rate
  // is what would catch a client-side normalization mismatch before it ships silently.
  async function getDecision(soc: string): Promise<PublicDecision> {
    const normalized = normalizeSoc(soc)
    const result = await pg.query<Pick<DeviceSupportRow, 'decision'>>(SQL`
      SELECT decision FROM device_soc_support WHERE soc_key = REPLACE(${normalized}, ' ', '')
    `)
    const found = result.rows.length > 0
    metrics.increment('device_support_lookup_total', { found: String(found) })
    return found ? result.rows[0].decision : 'keep'
  }

  async function getAll(): Promise<DeviceSupportEntry[]> {
    const result = await pg.query<DeviceSupportRow>(SQL`
      SELECT soc_model, decision, updated_at, updated_by FROM device_soc_support ORDER BY soc_model
    `)
    return result.rows.map(toEntry)
  }

  // Conflict target is soc_key (the whitespace-stripped generated column getDecision/delete also
  // match on), not the exact-spelling PK. Targeting the PK would let a differently-spaced spelling
  // of an already-seeded chip (e.g. "EXYNOS7420" vs the seeded "EXYNOS 7420") insert as a second
  // row instead of updating the existing one, which is exactly the duplicate soc_key's unique
  // index now makes impossible. Also writes soc_model to EXCLUDED's spelling on conflict, so the
  // display value tracks the most recent submission.
  async function upsert(soc: string, decision: Decision, updatedBy: string): Promise<DeviceSupportEntry> {
    const normalized = normalizeSoc(soc)
    const result = await pg.query<DeviceSupportRow>(SQL`
      INSERT INTO device_soc_support (soc_model, decision, updated_by)
      VALUES (${normalized}, ${decision}, ${updatedBy})
      ON CONFLICT (soc_key)
      DO UPDATE SET soc_model = EXCLUDED.soc_model, decision = EXCLUDED.decision, updated_at = NOW(), updated_by = EXCLUDED.updated_by
      RETURNING soc_model, decision, updated_at, updated_by
    `)
    return toEntry(result.rows[0])
  }

  // Bulk-loading the PM's spreadsheet is the expected way this table gets populated/refreshed, as
  // one multi-row INSERT rather than one round trip per entry (320 statements for the full seed
  // list) -- a single statement is atomic on its own, so no explicit transaction is needed.
  //
  // Postgres refuses to let one ON CONFLICT DO UPDATE affect the same row twice within a single
  // statement ("ON CONFLICT DO UPDATE command cannot affect row a second time"), which a per-row
  // loop never hit since each row was its own statement. Two input entries can collide on soc_key
  // without colliding on spelling (e.g. "EXYNOS7420" and "EXYNOS 7420"), so entries are deduped
  // here first, keeping the last occurrence -- the same last-wins semantics the old loop had.
  async function bulkUpsert(entries: BulkUpsertEntry[], updatedBy: string): Promise<number> {
    if (entries.length === 0) return 0

    const bySocKey = new Map<string, BulkUpsertEntry>()
    for (const entry of entries) {
      bySocKey.set(normalizeSoc(entry.soc).replace(/ /g, ''), entry)
    }
    const deduped = [...bySocKey.values()]

    const query = SQL`INSERT INTO device_soc_support (soc_model, decision, updated_by) VALUES `
    deduped.forEach((entry, index) => {
      if (index > 0) query.append(SQL`, `)
      query.append(SQL`(${normalizeSoc(entry.soc)}, ${entry.decision}, ${updatedBy})`)
    })
    query.append(SQL`
      ON CONFLICT (soc_key)
      DO UPDATE SET soc_model = EXCLUDED.soc_model, decision = EXCLUDED.decision, updated_at = NOW(), updated_by = EXCLUDED.updated_by
    `)

    await pg.query(query)
    return deduped.length
  }

  // Same unique index guarantees this deletes at most one row.
  async function deleteSoc(soc: string): Promise<boolean> {
    const normalized = normalizeSoc(soc)
    const result = await pg.query(SQL`
      DELETE FROM device_soc_support WHERE soc_key = REPLACE(${normalized}, ' ', '')
    `)
    return result.rowCount > 0
  }

  return { getDecision, getAll, upsert, bulkUpsert, delete: deleteSoc }
}
