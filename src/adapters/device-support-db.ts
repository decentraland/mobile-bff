import SQL from 'sql-template-strings'
import { AppComponents } from '../types'
import { Decision, PublicDecision, normalizeSoc, toSocKey } from '../logic/device-support'

export type DeviceSupportEntry = {
  soc: string
  decision: Decision
  updatedAt: string
  updatedBy: string | null
}

export type BulkUpsertEntry = {
  soc: string
  // 'keep' deletes the row instead of upserting it -- see bulkUpsert.
  decision: PublicDecision
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
  metrics,
  cache
}: Pick<AppComponents, 'pg' | 'metrics' | 'cache'>): Promise<IDeviceSupportDbComponent> {
  // A ~320-row table that only changes through backoffice writes, but is read on every client
  // boot -- caching avoids a DB round trip per boot at steady state. Keyed by soc_key so casing/
  // spacing variants of the same chip share one entry; invalidated (not just left to expire) on
  // every write that could affect the key, so a write is visible immediately, not after TTL_MS.
  const CACHE_TTL_MS = 60_000
  const cacheKey = (socKey: string) => `device-support:${socKey}`

  // device_support_lookup_total{found} is the only production signal that a client's SoC string
  // isn't reaching this table in the form it's stored in -- an absent row is indistinguishable
  // from a genuinely fine chip otherwise (both resolve to 'keep'), so a rising found=false rate
  // is what would catch a client-side normalization mismatch before it ships silently. Counted on
  // cache hits too, so caching doesn't blind this metric.
  async function getDecision(soc: string): Promise<PublicDecision> {
    const key = toSocKey(soc)
    const cached = await cache.get<PublicDecision>(cacheKey(key))
    if (cached) {
      metrics.increment('device_support_lookup_total', { found: String(cached !== 'keep') })
      return cached
    }

    const result = await pg.query<Pick<DeviceSupportRow, 'decision'>>(SQL`
      SELECT decision FROM device_soc_support WHERE soc_key = ${key}
    `)
    const found = result.rows.length > 0
    const decision = found ? result.rows[0].decision : 'keep'
    metrics.increment('device_support_lookup_total', { found: String(found) })
    await cache.set(cacheKey(key), decision, CACHE_TTL_MS)
    return decision
  }

  async function getAll(): Promise<DeviceSupportEntry[]> {
    const result = await pg.query<DeviceSupportRow>(SQL`
      SELECT soc_model, decision, updated_at, updated_by FROM device_soc_support ORDER BY soc_model
    `)
    return result.rows.map(toEntry)
  }

  // Conflict target is soc_key (case/whitespace-normalized), not the exact-spelling PK -- so a
  // differently-spaced or -cased spelling of an already-seeded chip updates the existing row
  // instead of inserting a duplicate. Also writes soc_model to EXCLUDED's spelling on conflict, so
  // the display value tracks the most recent submission.
  async function upsert(soc: string, decision: Decision, updatedBy: string): Promise<DeviceSupportEntry> {
    const result = await pg.query<DeviceSupportRow>(SQL`
      INSERT INTO device_soc_support (soc_model, decision, updated_by)
      VALUES (${normalizeSoc(soc)}, ${decision}, ${updatedBy})
      ON CONFLICT (soc_key)
      DO UPDATE SET soc_model = EXCLUDED.soc_model, decision = EXCLUDED.decision, updated_at = NOW(), updated_by = EXCLUDED.updated_by
      RETURNING soc_model, decision, updated_at, updated_by
    `)
    await cache.invalidate(cacheKey(toSocKey(soc)))
    return toEntry(result.rows[0])
  }

  // Bulk-loading the PM's spreadsheet is the expected way this table gets populated/refreshed.
  // A 'keep' entry means "this soc was reverted/removed from the sheet" -- deleted rather than
  // upserted, since 'keep' is never a stored value. Without this, a soc the PM moves back to
  // 'keep' (or drops from the sheet) has no bulk way to revert; only a per-soc DELETE could.
  //
  // Deletes and upserts are two different statement shapes, so both run in one transaction here:
  // a batch that's part delete, part upsert must not partially apply. Entries are deduped by
  // soc_key first (last occurrence wins) -- two input entries can collide on soc_key without
  // colliding on spelling (e.g. "EXYNOS7420" and "EXYNOS 7420"), and Postgres refuses to let one
  // ON CONFLICT DO UPDATE affect the same row twice within a single statement.
  async function bulkUpsert(entries: BulkUpsertEntry[], updatedBy: string): Promise<number> {
    if (entries.length === 0) return 0

    const bySocKey = new Map<string, BulkUpsertEntry>()
    for (const entry of entries) {
      bySocKey.set(toSocKey(entry.soc), entry)
    }
    const deduped = [...bySocKey.values()]

    const toDelete = deduped.filter((entry) => entry.decision === 'keep')
    const toUpsert = deduped.filter((entry) => entry.decision !== 'keep') as {
      soc: string
      decision: Decision
    }[]

    const client = await pg.getPool().connect()
    try {
      await client.query('BEGIN')

      if (toDelete.length > 0) {
        const keys = toDelete.map((entry) => toSocKey(entry.soc))
        await client.query(SQL`DELETE FROM device_soc_support WHERE soc_key = ANY(${keys})`)
      }

      if (toUpsert.length > 0) {
        const query = SQL`INSERT INTO device_soc_support (soc_model, decision, updated_by) VALUES `
        toUpsert.forEach((entry, index) => {
          if (index > 0) query.append(SQL`, `)
          query.append(SQL`(${normalizeSoc(entry.soc)}, ${entry.decision}, ${updatedBy})`)
        })
        query.append(SQL`
          ON CONFLICT (soc_key)
          DO UPDATE SET soc_model = EXCLUDED.soc_model, decision = EXCLUDED.decision, updated_at = NOW(), updated_by = EXCLUDED.updated_by
        `)
        await client.query(query)
      }

      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }

    await Promise.all(deduped.map((entry) => cache.invalidate(cacheKey(toSocKey(entry.soc)))))
    return deduped.length
  }

  async function deleteSoc(soc: string): Promise<boolean> {
    const key = toSocKey(soc)
    const result = await pg.query(SQL`
      DELETE FROM device_soc_support WHERE soc_key = ${key}
    `)
    await cache.invalidate(cacheKey(key))
    return result.rowCount > 0
  }

  return { getDecision, getAll, upsert, bulkUpsert, delete: deleteSoc }
}
