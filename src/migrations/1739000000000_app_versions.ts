import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('app_versions', {
    id: { type: 'int', primaryKey: true, default: 1 },
    ios_minimal_required_version: { type: 'int', notNull: true },
    ios_recommended_version: { type: 'int', notNull: true },
    android_minimal_required_version: { type: 'int', notNull: true },
    android_recommended_version: { type: 'int', notNull: true },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_by: { type: 'varchar(64)', notNull: false }
  })

  // Singleton: only one row allowed
  pgm.addConstraint('app_versions', 'app_versions_singleton', {
    check: 'id = 1'
  })

  // Seed with initial values
  pgm.sql(`
    INSERT INTO app_versions (
      id,
      ios_minimal_required_version,
      ios_recommended_version,
      android_minimal_required_version,
      android_recommended_version
    ) VALUES (1, 1, 1, 1, 1)
  `)
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('app_versions')
}
