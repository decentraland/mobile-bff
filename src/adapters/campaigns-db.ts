import SQL from 'sql-template-strings'
import type { PoolClient } from 'pg'
import { AppComponents } from '../types'
import { TargetType } from '../logic/campaigns'

// What the client resolver consumes: only what it needs to route.
export type PublicCampaign = {
  target: { type: 'genesis'; position: string } | { type: 'world'; name: string }
}

export type PublicCampaignsMap = Record<string, PublicCampaign>

export type Campaign = PublicCampaign & {
  token: string
  startsAt: string | null
  endsAt: string | null
  enabled: boolean
  createdAt: string
  updatedAt: string
  updatedBy: string | null
}

export type CreateCampaignInput = {
  token: string
  targetType: TargetType
  targetPosition: string | null
  targetWorld: string | null
  startsAt: Date | null
  endsAt: Date | null
  enabled: boolean
}

export type UpdateCampaignInput = Partial<Omit<CreateCampaignInput, 'token'>>

export type CampaignAuditAction = 'create' | 'update' | 'delete'

export type CampaignAuditEntry = {
  id: number
  token: string
  action: CampaignAuditAction
  changes: Record<string, unknown> | null
  actor: string
  createdAt: string
}

export type ICampaignsDbComponent = {
  /** Enabled campaigns inside their active window, keyed by token. Client-facing. */
  getActive(): Promise<PublicCampaignsMap>
  getAll(): Promise<Campaign[]>
  getByToken(token: string): Promise<Campaign | null>
  create(input: CreateCampaignInput, actor: string): Promise<Campaign>
  update(token: string, changes: UpdateCampaignInput, actor: string): Promise<Campaign | null>
  delete(token: string, actor: string): Promise<boolean>
  getAudit(token: string, limit: number): Promise<CampaignAuditEntry[]>
}

type CampaignRow = {
  token: string
  target_type: TargetType
  target_position: string | null
  target_world: string | null
  starts_at: Date | null
  ends_at: Date | null
  enabled: boolean
  created_at: Date
  updated_at: Date
  updated_by: string | null
}

type CampaignAuditRow = {
  id: number
  token: string
  action: CampaignAuditAction
  changes: Record<string, unknown> | null
  actor: string
  created_at: Date
}

const COLUMNS =
  'token, target_type, target_position, target_world, ' +
  'starts_at, ends_at, enabled, created_at, updated_at, updated_by'

function toTarget(row: Pick<CampaignRow, 'target_type' | 'target_position' | 'target_world'>) {
  return row.target_type === 'world'
    ? ({ type: 'world', name: row.target_world as string } as const)
    : ({ type: 'genesis', position: row.target_position as string } as const)
}

function toPublicCampaign(row: CampaignRow): PublicCampaign {
  return { target: toTarget(row) }
}

function toCampaign(row: CampaignRow): Campaign {
  return {
    token: row.token,
    ...toPublicCampaign(row),
    startsAt: row.starts_at ? new Date(row.starts_at).toISOString() : null,
    endsAt: row.ends_at ? new Date(row.ends_at).toISOString() : null,
    enabled: row.enabled,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    updatedBy: row.updated_by
  }
}

function toAuditEntry(row: CampaignAuditRow): CampaignAuditEntry {
  return {
    id: row.id,
    token: row.token,
    action: row.action,
    changes: row.changes,
    actor: row.actor,
    createdAt: new Date(row.created_at).toISOString()
  }
}

export async function createCampaignsDbComponent({ pg }: Pick<AppComponents, 'pg'>): Promise<ICampaignsDbComponent> {

  // A campaign write and its audit row have to land together: a change that applied but was
  // never recorded defeats the point of having a trail. pg.query() checks a connection out of
  // the pool per call, so BEGIN/COMMIT issued through it can land on different connections —
  // the transaction needs one client held for its whole span.
  async function withTransaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pg.getPool().connect()
    try {
      await client.query('BEGIN')
      const result = await run(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async function writeAudit(
    client: PoolClient,
    token: string,
    action: CampaignAuditAction,
    changes: Record<string, unknown> | null,
    actor: string
  ): Promise<void> {
    await client.query(SQL`
      INSERT INTO campaign_audit (token, action, changes, actor)
      VALUES (${token}, ${action}, ${changes ? JSON.stringify(changes) : null}, ${actor})
    `)
  }

  async function getActive(): Promise<PublicCampaignsMap> {
    // The window is evaluated server-side so a client with a skewed clock, or one
    // serving a stale cached map, cannot resurrect an expired campaign.
    const query = SQL`SELECT `.append(COLUMNS).append(SQL` FROM campaigns
      WHERE enabled = true
        AND (starts_at IS NULL OR starts_at <= NOW())
        AND (ends_at IS NULL OR ends_at > NOW())
      ORDER BY token
    `)
    const result = await pg.query<CampaignRow>(query)
    return Object.fromEntries(result.rows.map(row => [row.token, toPublicCampaign(row)]))
  }

  async function getAll(): Promise<Campaign[]> {
    const query = SQL`SELECT `.append(COLUMNS).append(' FROM campaigns ORDER BY created_at DESC')
    const result = await pg.query<CampaignRow>(query)
    return result.rows.map(toCampaign)
  }

  async function getByToken(token: string): Promise<Campaign | null> {
    const query = SQL`SELECT `.append(COLUMNS).append(SQL` FROM campaigns WHERE token = ${token}`)
    const result = await pg.query<CampaignRow>(query)
    return result.rows.length > 0 ? toCampaign(result.rows[0]) : null
  }

  async function create(input: CreateCampaignInput, actor: string): Promise<Campaign> {
    return withTransaction(async client => {
      const query = SQL`
        INSERT INTO campaigns (
          token, target_type, target_position, target_world,
          starts_at, ends_at, enabled, updated_by
        ) VALUES (
          ${input.token}, ${input.targetType}, ${input.targetPosition}, ${input.targetWorld},
          ${input.startsAt}, ${input.endsAt}, ${input.enabled}, ${actor}
        )
        RETURNING `.append(COLUMNS)
      const result = await client.query<CampaignRow>(query)
      const campaign = toCampaign(result.rows[0])
      await writeAudit(client, input.token, 'create', campaign as unknown as Record<string, unknown>, actor)
      return campaign
    })
  }

  async function update(
    token: string,
    changes: UpdateCampaignInput,
    actor: string
  ): Promise<Campaign | null> {
    const entries = Object.entries(changes).filter(([, value]) => value !== undefined)
    if (entries.length === 0) {
      throw new Error('update requires at least one change')
    }

    const query = SQL`UPDATE campaigns SET updated_at = NOW(), updated_by = ${actor}`
    if (changes.targetType !== undefined) query.append(SQL`, target_type = ${changes.targetType}`)
    if (changes.targetPosition !== undefined) query.append(SQL`, target_position = ${changes.targetPosition}`)
    if (changes.targetWorld !== undefined) query.append(SQL`, target_world = ${changes.targetWorld}`)
    if (changes.startsAt !== undefined) query.append(SQL`, starts_at = ${changes.startsAt}`)
    if (changes.endsAt !== undefined) query.append(SQL`, ends_at = ${changes.endsAt}`)
    if (changes.enabled !== undefined) query.append(SQL`, enabled = ${changes.enabled}`)
    query.append(SQL` WHERE token = ${token} RETURNING `).append(COLUMNS)

    return withTransaction(async client => {
      const result = await client.query<CampaignRow>(query)
      if (result.rows.length === 0) {
        return null
      }
      await writeAudit(client, token, 'update', Object.fromEntries(entries), actor)
      return toCampaign(result.rows[0])
    })
  }

  async function deleteCampaign(token: string, actor: string): Promise<boolean> {
    return withTransaction(async client => {
      // Deleted inside the transaction and RETURNING the row, so the snapshot written to the
      // trail is exactly what was removed even if something else touches the row meanwhile.
      const query = SQL`DELETE FROM campaigns WHERE token = ${token} RETURNING `.append(COLUMNS)
      const result = await client.query<CampaignRow>(query)
      if (result.rows.length === 0) {
        return false
      }
      const removed = toCampaign(result.rows[0])
      await writeAudit(client, token, 'delete', removed as unknown as Record<string, unknown>, actor)
      return true
    })
  }

  async function getAudit(token: string, limit: number): Promise<CampaignAuditEntry[]> {
    const result = await pg.query<CampaignAuditRow>(SQL`
      SELECT id, token, action, changes, actor, created_at
      FROM campaign_audit
      WHERE token = ${token}
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit}
    `)
    return result.rows.map(toAuditEntry)
  }

  return { getActive, getAll, getByToken, create, update, delete: deleteCampaign, getAudit }
}
