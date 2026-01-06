import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Create bans table for banning scene groups or individual scenes
  pgm.createTable('bans', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    // FK to scene_groups - if set, this is a group ban; if null, it's a scene ban
    group_id: {
      type: 'uuid',
      notNull: false,
      references: 'scene_groups',
      onDelete: 'CASCADE'
    },
    // Optional reason for the ban
    reason: { type: 'text', notNull: false },
    // Who created the ban (wallet address)
    created_by: { type: 'varchar(42)', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') }
  })

  // Unique constraint on group_id for group bans (only one ban per group)
  pgm.createIndex('bans', 'group_id', { unique: true, where: 'group_id IS NOT NULL' })

  // Index for sorting by creation date
  pgm.createIndex('bans', 'created_at')

  // Create ban_parcels table to store parcels for scene bans
  // For scene bans (where group_id is null), this identifies which parcels are banned
  pgm.createTable('ban_parcels', {
    ban_id: {
      type: 'uuid',
      notNull: true,
      references: 'bans',
      onDelete: 'CASCADE'
    },
    x: { type: 'integer', notNull: true },
    y: { type: 'integer', notNull: true }
  })

  // Primary key ensures no duplicate parcels per ban
  pgm.addConstraint('ban_parcels', 'ban_parcels_pkey', {
    primaryKey: ['ban_id', 'x', 'y']
  })

  // Index for fetching all parcels of a ban
  pgm.createIndex('ban_parcels', 'ban_id')
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('ban_parcels')
  pgm.dropTable('bans')
}
