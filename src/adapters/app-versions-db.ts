import SQL from 'sql-template-strings'
import { AppComponents } from '../types'

export type PlatformVersions = {
  minimalRequiredVersionNumber: number
  recommendedVersionNumber: number
}

export type AppVersions = {
  ios: PlatformVersions
  android: PlatformVersions
}

export type IAppVersionsDbComponent = {
  get(): Promise<AppVersions>
  update(values: AppVersions, updatedBy: string): Promise<AppVersions>
}

type AppVersionsRow = {
  ios_minimal_required_version: number
  ios_recommended_version: number
  android_minimal_required_version: number
  android_recommended_version: number
}

export async function createAppVersionsDbComponent({ pg }: Pick<AppComponents, 'pg'>): Promise<IAppVersionsDbComponent> {

  function toAppVersions(row: AppVersionsRow): AppVersions {
    return {
      ios: {
        minimalRequiredVersionNumber: row.ios_minimal_required_version,
        recommendedVersionNumber: row.ios_recommended_version
      },
      android: {
        minimalRequiredVersionNumber: row.android_minimal_required_version,
        recommendedVersionNumber: row.android_recommended_version
      }
    }
  }

  async function get(): Promise<AppVersions> {
    const query = SQL`
      SELECT
        ios_minimal_required_version,
        ios_recommended_version,
        android_minimal_required_version,
        android_recommended_version
      FROM app_versions
      WHERE id = 1
    `
    const result = await pg.query<AppVersionsRow>(query)
    if (result.rows.length === 0) {
      throw new Error('app_versions singleton row not found — DB seed missing or row was deleted')
    }
    return toAppVersions(result.rows[0])
  }

  async function update(values: AppVersions, updatedBy: string): Promise<AppVersions> {
    const query = SQL`
      UPDATE app_versions
      SET
        ios_minimal_required_version = ${values.ios.minimalRequiredVersionNumber},
        ios_recommended_version = ${values.ios.recommendedVersionNumber},
        android_minimal_required_version = ${values.android.minimalRequiredVersionNumber},
        android_recommended_version = ${values.android.recommendedVersionNumber},
        updated_at = NOW(),
        updated_by = ${updatedBy}
      WHERE id = 1
      RETURNING
        ios_minimal_required_version,
        ios_recommended_version,
        android_minimal_required_version,
        android_recommended_version
    `
    const result = await pg.query<AppVersionsRow>(query)
    if (result.rows.length === 0) {
      throw new Error('app_versions singleton row not found — DB seed missing or row was deleted')
    }
    return toAppVersions(result.rows[0])
  }

  return { get, update }
}
