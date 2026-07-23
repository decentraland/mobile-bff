import SQL from 'sql-template-strings'
import { AppComponents } from '../types'

export type FeatureFlagsMap = Record<string, boolean>

export type FeatureFlag = {
  name: string
  enabled: boolean
  description: string | null
  updatedAt: string
  updatedBy: string | null
}

export type CreateFeatureFlagInput = {
  name: string
  enabled: boolean
  description: string | null
}

export type UpdateFeatureFlagInput = {
  enabled?: boolean
  description?: string | null
}

export type IFeatureFlagsDbComponent = {
  getAll(): Promise<FeatureFlagsMap>
  getAllDetailed(): Promise<FeatureFlag[]>
  create(input: CreateFeatureFlagInput, createdBy: string): Promise<FeatureFlag>
  update(name: string, changes: UpdateFeatureFlagInput, updatedBy: string): Promise<FeatureFlag | null>
  delete(name: string): Promise<boolean>
}

type FeatureFlagRow = {
  name: string
  enabled: boolean
  description: string | null
  updated_at: Date
  updated_by: string | null
}

const RETURNING_COLUMNS = 'name, enabled, description, updated_at, updated_by'

function toFeatureFlag(row: FeatureFlagRow): FeatureFlag {
  return {
    name: row.name,
    enabled: row.enabled,
    description: row.description,
    updatedAt: new Date(row.updated_at).toISOString(),
    updatedBy: row.updated_by
  }
}

export async function createFeatureFlagsDbComponent({ pg }: Pick<AppComponents, 'pg'>): Promise<IFeatureFlagsDbComponent> {

  async function getAll(): Promise<FeatureFlagsMap> {
    const result = await pg.query<FeatureFlagRow>(SQL`SELECT name, enabled FROM feature_flags ORDER BY name`)
    return Object.fromEntries(result.rows.map(row => [row.name, row.enabled]))
  }

  async function getAllDetailed(): Promise<FeatureFlag[]> {
    const result = await pg.query<FeatureFlagRow>(SQL`
      SELECT name, enabled, description, updated_at, updated_by FROM feature_flags ORDER BY name
    `)
    return result.rows.map(toFeatureFlag)
  }

  async function create(input: CreateFeatureFlagInput, createdBy: string): Promise<FeatureFlag> {
    const result = await pg.query<FeatureFlagRow>(SQL`
      INSERT INTO feature_flags (name, enabled, description, updated_by)
      VALUES (${input.name}, ${input.enabled}, ${input.description}, ${createdBy})
      RETURNING name, enabled, description, updated_at, updated_by
    `)
    return toFeatureFlag(result.rows[0])
  }

  async function update(name: string, changes: UpdateFeatureFlagInput, updatedBy: string): Promise<FeatureFlag | null> {
    if (changes.enabled === undefined && changes.description === undefined) {
      throw new Error('update requires at least one change')
    }

    const query = SQL`UPDATE feature_flags SET updated_at = NOW(), updated_by = ${updatedBy}`
    if (changes.enabled !== undefined) {
      query.append(SQL`, enabled = ${changes.enabled}`)
    }
    if (changes.description !== undefined) {
      query.append(SQL`, description = ${changes.description}`)
    }
    query.append(SQL` WHERE name = ${name} RETURNING `).append(RETURNING_COLUMNS)

    const result = await pg.query<FeatureFlagRow>(query)
    return result.rows.length > 0 ? toFeatureFlag(result.rows[0]) : null
  }

  async function deleteFlag(name: string): Promise<boolean> {
    const result = await pg.query(SQL`DELETE FROM feature_flags WHERE name = ${name}`)
    return result.rowCount > 0
  }

  return { getAll, getAllDetailed, create, update, delete: deleteFlag }
}
