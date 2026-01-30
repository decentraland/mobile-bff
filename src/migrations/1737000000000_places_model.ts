import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Create place_groups table for rendering places together
  pgm.createTable('place_groups', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    name: { type: 'varchar(255)', notNull: true },
    description: { type: 'text', notNull: false, default: "''" },
    color: { type: 'varchar(7)', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') }
  })

  // Index for sorting by creation date
  pgm.createIndex('place_groups', 'created_at')

  // Create places table - core entity for scenes and worlds
  pgm.createTable('places', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    type: { type: 'varchar(10)', notNull: true },
    // For scenes: base position as "x,y" string
    base_position: { type: 'varchar(20)', notNull: false },
    // For worlds: world name
    world_name: { type: 'varchar(255)', notNull: false },
    // Entity ID for tracking scene deployments
    scene_id: { type: 'varchar(255)', notNull: false },
    // Optional group membership
    group_id: {
      type: 'uuid',
      notNull: false,
      references: 'place_groups',
      onDelete: 'SET NULL'
    },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') }
  })

  // Check constraint for type values
  pgm.addConstraint('places', 'places_type_check', {
    check: "type IN ('scene', 'world')"
  })

  // Check constraint ensuring scene has base position or world has name
  pgm.addConstraint('places', 'places_scene_check', {
    check: "(type = 'scene' AND base_position IS NOT NULL) OR (type = 'world' AND world_name IS NOT NULL)"
  })

  // Unique constraint on base position for scenes
  pgm.createIndex('places', 'base_position', {
    unique: true,
    where: 'base_position IS NOT NULL'
  })

  // Unique constraint on world name for worlds
  pgm.createIndex('places', 'world_name', {
    unique: true,
    where: 'world_name IS NOT NULL'
  })

  // Index for group membership queries
  pgm.createIndex('places', 'group_id')

  // Index for type filtering
  pgm.createIndex('places', 'type')

  // Index for sorting by creation date
  pgm.createIndex('places', 'created_at')

  // Create place_positions table for multi-parcel scenes (using "x,y" string format)
  pgm.createTable('place_positions', {
    place_id: {
      type: 'uuid',
      notNull: true,
      references: 'places',
      onDelete: 'CASCADE'
    },
    position: { type: 'varchar(20)', notNull: true }
  })

  // Primary key on position - each position belongs to one place only
  pgm.addConstraint('place_positions', 'place_positions_pkey', {
    primaryKey: 'position'
  })

  // Index for fetching all positions of a place
  pgm.createIndex('place_positions', 'place_id')

  // Create place_tags junction table
  pgm.createTable('place_tags', {
    place_id: {
      type: 'uuid',
      notNull: true,
      references: 'places',
      onDelete: 'CASCADE'
    },
    tag_id: {
      type: 'uuid',
      notNull: true,
      references: 'tags',
      onDelete: 'CASCADE'
    },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') }
  })

  // Add composite primary key
  pgm.addConstraint('place_tags', 'place_tags_pkey', {
    primaryKey: ['place_id', 'tag_id']
  })

  // Index for efficient tag filtering
  pgm.createIndex('place_tags', 'tag_id')

  // Add place_id to bans table for place bans
  pgm.addColumn('bans', {
    place_id: {
      type: 'uuid',
      notNull: false,
      references: 'places',
      onDelete: 'CASCADE'
    }
  })

  // Unique partial index on place_id for place bans
  pgm.createIndex('bans', 'place_id', {
    unique: true,
    where: 'place_id IS NOT NULL'
  })

  // Change ban_positions to use string position format
  pgm.dropTable('ban_parcels', { ifExists: true })
  pgm.createTable('ban_positions', {
    ban_id: {
      type: 'uuid',
      notNull: true,
      references: 'bans',
      onDelete: 'CASCADE'
    },
    position: { type: 'varchar(20)', notNull: true }
  })

  // Composite primary key on ban_id and position
  pgm.addConstraint('ban_positions', 'ban_positions_pkey', {
    primaryKey: ['ban_id', 'position']
  })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Recreate ban_parcels with original schema
  pgm.dropTable('ban_positions')
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
  pgm.addConstraint('ban_parcels', 'ban_parcels_pkey', {
    primaryKey: ['ban_id', 'x', 'y']
  })

  // Remove place_id from bans
  pgm.dropIndex('bans', 'place_id')
  pgm.dropColumn('bans', 'place_id')

  // Drop place_tags table
  pgm.dropTable('place_tags')

  // Drop place_positions table
  pgm.dropTable('place_positions')

  // Drop places table
  pgm.dropTable('places')

  // Drop place_groups table
  pgm.dropTable('place_groups')
}
