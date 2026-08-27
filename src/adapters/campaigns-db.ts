import SQL from 'sql-template-strings'
import { AppComponents } from '../types'
import { TargetType } from '../logic/campaigns'

// What the client resolver consumes: only what it needs to route.
export type PublicCampaign = {
  target: { type: 'genesis'; position: string } | { type: 'world'; name: string }
}

export type PublicCampaignsMap = Record<string, PublicCampaign>

export type Campaign = PublicCampaign & {
  token: string
}

export type CreateCampaignInput = {
  token: string
  targetType: TargetType
  targetPosition: string | null
  targetWorld: string | null
}

export type UpdateCampaignInput = Omit<CreateCampaignInput, 'token'>

export type ICampaignsDbComponent = {
  /** Every campaign, keyed by token. Client-facing. */
  getMap(): Promise<PublicCampaignsMap>
  getAll(): Promise<Campaign[]>
  getByToken(token: string): Promise<Campaign | null>
  create(input: CreateCampaignInput): Promise<Campaign>
  update(token: string, changes: UpdateCampaignInput): Promise<Campaign | null>
  delete(token: string): Promise<boolean>
}

type CampaignRow = {
  token: string
  target_type: TargetType
  target_position: string | null
  target_world: string | null
}

const COLUMNS = 'token, target_type, target_position, target_world'

function toTarget(row: CampaignRow) {
  return row.target_type === 'world'
    ? ({ type: 'world', name: row.target_world as string } as const)
    : ({ type: 'genesis', position: row.target_position as string } as const)
}

function toCampaign(row: CampaignRow): Campaign {
  return { token: row.token, target: toTarget(row) }
}

export async function createCampaignsDbComponent({ pg }: Pick<AppComponents, 'pg'>): Promise<ICampaignsDbComponent> {
  async function getMap(): Promise<PublicCampaignsMap> {
    const query = SQL`SELECT `.append(COLUMNS).append(' FROM campaigns ORDER BY token')
    const result = await pg.query<CampaignRow>(query)
    return Object.fromEntries(result.rows.map(row => [row.token, { target: toTarget(row) }]))
  }

  async function getAll(): Promise<Campaign[]> {
    const query = SQL`SELECT `.append(COLUMNS).append(' FROM campaigns ORDER BY token')
    const result = await pg.query<CampaignRow>(query)
    return result.rows.map(toCampaign)
  }

  async function getByToken(token: string): Promise<Campaign | null> {
    const query = SQL`SELECT `.append(COLUMNS).append(SQL` FROM campaigns WHERE token = ${token}`)
    const result = await pg.query<CampaignRow>(query)
    return result.rows.length > 0 ? toCampaign(result.rows[0]) : null
  }

  async function create(input: CreateCampaignInput): Promise<Campaign> {
    const query = SQL`
      INSERT INTO campaigns (token, target_type, target_position, target_world)
      VALUES (${input.token}, ${input.targetType}, ${input.targetPosition}, ${input.targetWorld})
      RETURNING `.append(COLUMNS)
    const result = await pg.query<CampaignRow>(query)
    return toCampaign(result.rows[0])
  }

  // The target is replaced as a unit — the three columns are constrained together, so a
  // partial change cannot be validated on its own.
  async function update(token: string, changes: UpdateCampaignInput): Promise<Campaign | null> {
    const query = SQL`
      UPDATE campaigns SET
        target_type = ${changes.targetType},
        target_position = ${changes.targetPosition},
        target_world = ${changes.targetWorld}
      WHERE token = ${token}
      RETURNING `.append(COLUMNS)
    const result = await pg.query<CampaignRow>(query)
    return result.rows.length > 0 ? toCampaign(result.rows[0]) : null
  }

  async function deleteCampaign(token: string): Promise<boolean> {
    const result = await pg.query(SQL`DELETE FROM campaigns WHERE token = ${token}`)
    return (result.rowCount ?? 0) > 0
  }

  return { getMap, getAll, getByToken, create, update, delete: deleteCampaign }
}
