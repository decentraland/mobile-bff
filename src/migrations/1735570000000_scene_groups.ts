import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Create scene_groups table
  pgm.createTable('scene_groups', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    name: { type: 'varchar(255)', notNull: true },
    description: { type: 'text', notNull: false, default: "''" },
    color: { type: 'varchar(7)', notNull: true },
    tags: { type: 'text[]', notNull: true, default: pgm.func("ARRAY[]::text[]") },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') }
  })

  // GIN index for tag queries
  pgm.createIndex('scene_groups', 'tags', { method: 'gin' })

  // Index for sorting by creation date
  pgm.createIndex('scene_groups', 'created_at')

  // Create scene_group_parcels table
  pgm.createTable('scene_group_parcels', {
    scene_group_id: {
      type: 'uuid',
      notNull: true,
      references: 'scene_groups',
      onDelete: 'CASCADE'
    },
    x: { type: 'integer', notNull: true },
    y: { type: 'integer', notNull: true }
  })

  // Primary key on (x, y) ensures one parcel can only belong to one group
  pgm.addConstraint('scene_group_parcels', 'scene_group_parcels_pkey', {
    primaryKey: ['x', 'y']
  })

  // Index for fetching all parcels of a group
  pgm.createIndex('scene_group_parcels', 'scene_group_id')
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('scene_group_parcels')
  pgm.dropTable('scene_groups')
}
