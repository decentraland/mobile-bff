import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

// Turns the app_versions singleton into one row per *track*.
//
// Why: godot-explorer 1.12.0 through 1.13.1 render the force-update overlay on a
// CanvasLayer *below* the startup splash and never dismiss the splash, so a client in
// that range that receives a hard gate hangs on the startup spinner with no way out.
// The thresholds those clients read can therefore never be raised again — they are
// frozen for the lifetime of those installs. Fixed clients (1.13.2+) read a different
// track, whose numbers stay free to move.
//
// The legacy row keeps serving GET /app-versions unchanged; the new `v2` row is served
// at GET /app-versions/v2 and is seeded as a copy of legacy, so behaviour is identical
// on day one in every environment.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.dropConstraint('app_versions', 'app_versions_singleton')
  pgm.addColumn('app_versions', { track: { type: 'text' } })
  pgm.sql(`UPDATE app_versions SET track = 'legacy'`)
  pgm.alterColumn('app_versions', 'track', { notNull: true })

  // Dropping the column takes the singleton primary key with it.
  pgm.dropColumn('app_versions', 'id')
  pgm.addConstraint('app_versions', 'app_versions_pkey', { primaryKey: 'track' })

  // Same kebab-case shape as feature flag names, so tracks stay URL-safe.
  pgm.addConstraint('app_versions', 'app_versions_track_format', {
    check: "track ~ '^[a-z0-9]+(-[a-z0-9]+)*$'"
  })

  pgm.sql(`
    INSERT INTO app_versions (
      track,
      ios_minimal_required_version,
      ios_recommended_version,
      android_minimal_required_version,
      android_recommended_version
    )
    SELECT
      'v2',
      ios_minimal_required_version,
      ios_recommended_version,
      android_minimal_required_version,
      android_recommended_version
    FROM app_versions
    WHERE track = 'legacy'
  `)
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DELETE FROM app_versions WHERE track <> 'legacy'`)
  pgm.dropConstraint('app_versions', 'app_versions_track_format')
  pgm.dropConstraint('app_versions', 'app_versions_pkey')
  pgm.dropColumn('app_versions', 'track')
  pgm.addColumn('app_versions', { id: { type: 'int', default: 1 } })
  pgm.sql(`UPDATE app_versions SET id = 1`)
  pgm.alterColumn('app_versions', 'id', { notNull: true })
  pgm.addConstraint('app_versions', 'app_versions_pkey', { primaryKey: 'id' })
  pgm.addConstraint('app_versions', 'app_versions_singleton', { check: 'id = 1' })
}
