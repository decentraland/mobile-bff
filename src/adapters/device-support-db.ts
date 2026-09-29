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
  // Whitespace-insensitive on both sides (REPLACE ... ' ', '') so a client-reported value that
  // differs from the stored one only by a missing/extra space (e.g. "EXYNOS7420" vs the seeded
  // "EXYNOS 7420" -- 18 of the 320 seed rows have an internal space) still matches. soc_model is
  // stored with its natural spacing for backoffice readability; this only affects comparison.
  //
  // device_support_lookup_total{found} is the only production signal that a client's SoC string
  // isn't reaching this table in the form it's stored in -- an absent row is indistinguishable
  // from a genuinely fine chip otherwise (both resolve to 'keep'), so a rising found=false rate
  // is what would catch a client-side normalization mismatch before it ships silently.
  async function getDecision(soc: string): Promise<PublicDecision> {
    const normalized = normalizeSoc(soc)
    const result = await pg.query<Pick<DeviceSupportRow, 'decision'>>(SQL`
      SELECT decision FROM device_soc_support WHERE REPLACE(soc_model, ' ', '') = REPLACE(${normalized}, ' ', '')
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

  async function upsert(soc: string, decision: Decision, updatedBy: string): Promise<DeviceSupportEntry> {
    const normalized = normalizeSoc(soc)
    const result = await pg.query<DeviceSupportRow>(SQL`
      INSERT INTO device_soc_support (soc_model, decision, updated_by)
      VALUES (${normalized}, ${decision}, ${updatedBy})
      ON CONFLICT (soc_model) DO UPDATE SET decision = ${decision}, updated_at = NOW(), updated_by = ${updatedBy}
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
          ON CONFLICT (soc_model) DO UPDATE SET decision = ${entry.decision}, updated_at = NOW(), updated_by = ${updatedBy}
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

  async function deleteSoc(soc: string): Promise<boolean> {
    const normalized = normalizeSoc(soc)
    const result = await pg.query(SQL`
      DELETE FROM device_soc_support WHERE REPLACE(soc_model, ' ', '') = REPLACE(${normalized}, ' ', '')
    `)
    return result.rowCount > 0
  }

  return { getDecision, getAll, upsert, bulkUpsert, delete: deleteSoc }
}
