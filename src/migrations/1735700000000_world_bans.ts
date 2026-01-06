import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Add world_name column to bans table for world bans
  // A ban can be: group ban (group_id set), scene ban (parcels set), or world ban (world_name set)
  pgm.addColumn('bans', {
    world_name: { type: 'varchar(255)', notNull: false }
  })

  // Create unique index on world_name for world bans (only one ban per world)
  pgm.createIndex('bans', 'world_name', { unique: true, where: 'world_name IS NOT NULL' })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropIndex('bans', 'world_name')
  pgm.dropColumn('bans', 'world_name')
}
