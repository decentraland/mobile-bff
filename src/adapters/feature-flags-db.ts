import SQL from 'sql-template-strings'
import { AppComponents } from '../types'

export type FeatureFlagsMap = Record<string, boolean>

export type IFeatureFlagsDbComponent = {
  getAll(): Promise<FeatureFlagsMap>
  update(changes: FeatureFlagsMap, updatedBy: string): Promise<FeatureFlagsMap>
}

type FeatureFlagRow = {
  name: string
  enabled: boolean
}

export async function createFeatureFlagsDbComponent({ pg }: Pick<AppComponents, 'pg'>): Promise<IFeatureFlagsDbComponent> {

  async function getAll(): Promise<FeatureFlagsMap> {
    const result = await pg.query<FeatureFlagRow>(SQL`SELECT name, enabled FROM feature_flags ORDER BY name`)
    return Object.fromEntries(result.rows.map(row => [row.name, row.enabled]))
  }

  async function update(changes: FeatureFlagsMap, updatedBy: string): Promise<FeatureFlagsMap> {
    const entries = Object.entries(changes)
    if (entries.length === 0) {
      throw new Error('update requires at least one flag change')
    }

    // Single atomic multi-row update: UPDATE ... FROM (VALUES ...) v(name, enabled)
    const query = SQL`
      UPDATE feature_flags AS ff
      SET enabled = v.enabled, updated_at = NOW(), updated_by = ${updatedBy}
      FROM (VALUES `
    entries.forEach(([name, enabled], index) => {
      if (index > 0) query.append(', ')
      query.append(SQL`(${name}::text, ${enabled}::boolean)`)
    })
    query.append(SQL`) AS v(name, enabled)
      WHERE ff.name = v.name`)

    await pg.query(query)
    return getAll()
  }

  return { getAll, update }
}
