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

export type AppVersionsTrack = AppVersions & {
  track: string
  updatedAt: string
  updatedBy: string | null
}

export type IAppVersionsDbComponent = {
  // Returns null when the track does not exist.
  get(track: string): Promise<AppVersions | null>
  getAll(): Promise<AppVersionsTrack[]>
  // Returns null when the track does not exist.
  update(track: string, values: AppVersions, updatedBy: string): Promise<AppVersions | null>
}

type AppVersionsRow = {
  ios_minimal_required_version: number
  ios_recommended_version: number
  android_minimal_required_version: number
  android_recommended_version: number
}

type AppVersionsTrackRow = AppVersionsRow & {
  track: string
  updated_at: Date
  updated_by: string | null
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

  async function get(track: string): Promise<AppVersions | null> {
    const query = SQL`
      SELECT
        ios_minimal_required_version,
        ios_recommended_version,
        android_minimal_required_version,
        android_recommended_version
      FROM app_versions
      WHERE track = ${track}
    `
    const result = await pg.query<AppVersionsRow>(query)
    if (result.rows.length === 0) {
      return null
    }
    return toAppVersions(result.rows[0])
  }

  async function getAll(): Promise<AppVersionsTrack[]> {
    const query = SQL`
      SELECT
        track,
        ios_minimal_required_version,
        ios_recommended_version,
        android_minimal_required_version,
        android_recommended_version,
        updated_at,
        updated_by
      FROM app_versions
      ORDER BY track ASC
    `
    const result = await pg.query<AppVersionsTrackRow>(query)
    return result.rows.map((row) => ({
      track: row.track,
      ...toAppVersions(row),
      updatedAt: new Date(row.updated_at).toISOString(),
      updatedBy: row.updated_by
    }))
  }

  async function update(track: string, values: AppVersions, updatedBy: string): Promise<AppVersions | null> {
    const query = SQL`
      UPDATE app_versions
      SET
        ios_minimal_required_version = ${values.ios.minimalRequiredVersionNumber},
        ios_recommended_version = ${values.ios.recommendedVersionNumber},
        android_minimal_required_version = ${values.android.minimalRequiredVersionNumber},
        android_recommended_version = ${values.android.recommendedVersionNumber},
        updated_at = NOW(),
        updated_by = ${updatedBy}
      WHERE track = ${track}
      RETURNING
        ios_minimal_required_version,
        ios_recommended_version,
        android_minimal_required_version,
        android_recommended_version
    `
    const result = await pg.query<AppVersionsRow>(query)
    if (result.rows.length === 0) {
      return null
    }
    return toAppVersions(result.rows[0])
  }

  return { get, getAll, update }
}
