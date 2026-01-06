import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Add scene_id column to bans table to track the entity/scene ID at ban time
  // This allows detecting if a scene/world has been redeployed (new entity ID)
  pgm.addColumn('bans', {
    scene_id: { type: 'varchar(255)', notNull: false }
  })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropColumn('bans', 'scene_id')
}
