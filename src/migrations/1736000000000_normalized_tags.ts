import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Add world_name column to scene_groups
  pgm.addColumn('scene_groups', {
    world_name: { type: 'varchar(255)', notNull: false, default: null }
  })

  // Create unique index on world_name (partial index for non-null values)
  pgm.createIndex('scene_groups', 'world_name', {
    unique: true,
    where: 'world_name IS NOT NULL'
  })

  // Create tags table
  pgm.createTable('tags', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    name: { type: 'varchar(100)', notNull: true, unique: true },
    description: { type: 'text', notNull: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') }
  })

  // Create junction table for many-to-many relationship
  pgm.createTable('scene_group_tags', {
    group_id: {
      type: 'uuid',
      notNull: true,
      references: 'scene_groups',
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
  pgm.addConstraint('scene_group_tags', 'scene_group_tags_pkey', {
    primaryKey: ['group_id', 'tag_id']
  })

  // Index for efficient tag filtering
  pgm.createIndex('scene_group_tags', 'tag_id')

  // Migrate existing tags from array to normalized tables
  // First, insert unique tags into the tags table
  pgm.sql(`
    INSERT INTO tags (name)
    SELECT DISTINCT unnest(tags)
    FROM scene_groups
    WHERE tags != '{}'
    ON CONFLICT (name) DO NOTHING
  `)

  // Then, create the junction table entries
  pgm.sql(`
    INSERT INTO scene_group_tags (group_id, tag_id)
    SELECT sg.id, t.id
    FROM scene_groups sg
    CROSS JOIN LATERAL unnest(sg.tags) AS tag_name
    JOIN tags t ON t.name = tag_name
  `)

  // Note: We keep the old tags column for now as a backup
  // It can be dropped in a future migration after verifying data integrity
  // ALTER TABLE scene_groups DROP COLUMN tags;
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Drop junction table
  pgm.dropTable('scene_group_tags')

  // Drop tags table
  pgm.dropTable('tags')

  // Drop world_name index and column
  pgm.dropIndex('scene_groups', 'world_name')
  pgm.dropColumn('scene_groups', 'world_name')
}
