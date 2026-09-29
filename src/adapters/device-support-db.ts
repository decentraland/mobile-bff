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
  pg
}: Pick<AppComponents, 'pg'>): Promise<IDeviceSupportDbComponent> {
  async function getDecision(soc: string): Promise<PublicDecision> {
    const normalized = normalizeSoc(soc)
    const result = await pg.query<Pick<DeviceSupportRow, 'decision'>>(SQL`
      SELECT decision FROM device_soc_support WHERE soc_model = ${normalized}
    `)
    return result.rows.length > 0 ? result.rows[0].decision : 'keep'
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
  // one transaction so a bad row can't leave the table half-updated.
  async function bulkUpsert(entries: BulkUpsertEntry[], updatedBy: string): Promise<number> {
    if (entries.length === 0) return 0

    await pg.query(SQL`BEGIN`)
    try {
      for (const entry of entries) {
        const normalized = normalizeSoc(entry.soc)
        await pg.query(SQL`
          INSERT INTO device_soc_support (soc_model, decision, updated_by)
          VALUES (${normalized}, ${entry.decision}, ${updatedBy})
          ON CONFLICT (soc_model) DO UPDATE SET decision = ${entry.decision}, updated_at = NOW(), updated_by = ${updatedBy}
        `)
      }
      await pg.query(SQL`COMMIT`)
      return entries.length
    } catch (error) {
      await pg.query(SQL`ROLLBACK`)
      throw error
    }
  }

  async function deleteSoc(soc: string): Promise<boolean> {
    const normalized = normalizeSoc(soc)
    const result = await pg.query(SQL`DELETE FROM device_soc_support WHERE soc_model = ${normalized}`)
    return result.rowCount > 0
  }

  return { getDecision, getAll, upsert, bulkUpsert, delete: deleteSoc }
}
