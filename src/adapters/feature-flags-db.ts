import SQL from 'sql-template-strings'
import { AppComponents } from '../types'
import { FlagType } from '../logic/feature-flags'

// on-off flags map to their enabled boolean, text flags to their string value,
// number flags to their parsed numeric value
export type FeatureFlagsMap = Record<string, boolean | string | number>

export type FeatureFlag = {
  name: string
  type: FlagType
  enabled: boolean
  value: string | number | null
  description: string | null
  updatedAt: string
  updatedBy: string | null
}

export type CreateFeatureFlagInput = {
  name: string
  type: FlagType
  enabled: boolean
  value: string | null
  description: string | null
}

export type UpdateFeatureFlagInput = {
  enabled?: boolean
  value?: string
  description?: string | null
}

export type IFeatureFlagsDbComponent = {
  getAll(): Promise<FeatureFlagsMap>
  getAllDetailed(): Promise<FeatureFlag[]>
  getByName(name: string): Promise<FeatureFlag | null>
  create(input: CreateFeatureFlagInput, createdBy: string): Promise<FeatureFlag>
  update(name: string, changes: UpdateFeatureFlagInput, updatedBy: string): Promise<FeatureFlag | null>
  delete(name: string): Promise<boolean>
}

type FeatureFlagRow = {
  name: string
  type: FlagType
  enabled: boolean
  value: string | null
  description: string | null
  updated_at: Date
  updated_by: string | null
}

const RETURNING_COLUMNS = 'name, type, enabled, value, description, updated_at, updated_by'

function toFeatureFlag(row: FeatureFlagRow): FeatureFlag {
  return {
    name: row.name,
    type: row.type,
    enabled: row.enabled,
    value: row.type === 'number' && row.value !== null ? Number(row.value) : row.value,
    description: row.description,
    updatedAt: new Date(row.updated_at).toISOString(),
    updatedBy: row.updated_by
  }
}

function toPublicValue(row: Pick<FeatureFlagRow, 'type' | 'enabled' | 'value'>): boolean | string | number {
  switch (row.type) {
    case 'text':
      return row.value ?? ''
    case 'number':
      return Number(row.value)
    default:
      return row.enabled
  }
}

export async function createFeatureFlagsDbComponent({ pg }: Pick<AppComponents, 'pg'>): Promise<IFeatureFlagsDbComponent> {

  async function getAll(): Promise<FeatureFlagsMap> {
    const result = await pg.query<FeatureFlagRow>(SQL`SELECT name, type, enabled, value FROM feature_flags ORDER BY name`)
    return Object.fromEntries(result.rows.map(row => [row.name, toPublicValue(row)]))
  }

  async function getAllDetailed(): Promise<FeatureFlag[]> {
    const result = await pg.query<FeatureFlagRow>(SQL`
      SELECT name, type, enabled, value, description, updated_at, updated_by FROM feature_flags ORDER BY name
    `)
    return result.rows.map(toFeatureFlag)
  }

  async function getByName(name: string): Promise<FeatureFlag | null> {
    const result = await pg.query<FeatureFlagRow>(SQL`
      SELECT name, type, enabled, value, description, updated_at, updated_by FROM feature_flags WHERE name = ${name}
    `)
    return result.rows.length > 0 ? toFeatureFlag(result.rows[0]) : null
  }

  async function create(input: CreateFeatureFlagInput, createdBy: string): Promise<FeatureFlag> {
    const result = await pg.query<FeatureFlagRow>(SQL`
      INSERT INTO feature_flags (name, type, enabled, value, description, updated_by)
      VALUES (${input.name}, ${input.type}, ${input.enabled}, ${input.value}, ${input.description}, ${createdBy})
      RETURNING name, type, enabled, value, description, updated_at, updated_by
    `)
    return toFeatureFlag(result.rows[0])
  }

  async function update(name: string, changes: UpdateFeatureFlagInput, updatedBy: string): Promise<FeatureFlag | null> {
    if (changes.enabled === undefined && changes.value === undefined && changes.description === undefined) {
      throw new Error('update requires at least one change')
    }

    const query = SQL`UPDATE feature_flags SET updated_at = NOW(), updated_by = ${updatedBy}`
    if (changes.enabled !== undefined) {
      query.append(SQL`, enabled = ${changes.enabled}`)
    }
    if (changes.value !== undefined) {
      query.append(SQL`, value = ${changes.value}`)
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

  return { getAll, getAllDetailed, getByName, create, update, delete: deleteFlag }
}
