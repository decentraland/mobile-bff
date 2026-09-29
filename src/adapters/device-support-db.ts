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

  // Bulk-loading the PM's spreadsheet is the expected way this table gets populated/refreshed —
  // one transaction so a bad row can't leave the table half-updated. pg.query() checks out a
  // pooled connection per call, so BEGIN/INSERT/COMMIT could each land on a different physical
  // connection -- a dedicated client (mirroring push-db.ts's replaceAudience) is what actually
  // guarantees they share one.
  async function bulkUpsert(entries: BulkUpsertEntry[], updatedBy: string): Promise<number> {
    if (entries.length === 0) return 0

    const client = await pg.getPool().connect()
    try {
      await client.query('BEGIN')
      for (const entry of entries) {
        const normalized = normalizeSoc(entry.soc)
        await client.query(SQL`
          INSERT INTO device_soc_support (soc_model, decision, updated_by)
          VALUES (${normalized}, ${entry.decision}, ${updatedBy})
          ON CONFLICT (soc_key)
          DO UPDATE SET soc_model = EXCLUDED.soc_model, decision = EXCLUDED.decision, updated_at = NOW(), updated_by = EXCLUDED.updated_by
        `)
      }
      await client.query('COMMIT')
      return entries.length
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
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
