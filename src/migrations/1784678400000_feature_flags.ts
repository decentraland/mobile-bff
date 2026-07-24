import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('feature_flags', {
    name: { type: 'text', primaryKey: true },
    enabled: { type: 'boolean', notNull: true, default: false },
    description: { type: 'text', notNull: false },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_by: { type: 'varchar(64)', notNull: false }
  })

  // Flag names must match the godot-explorer deep-link param style (kebab-case)
  pgm.addConstraint('feature_flags', 'feature_flags_name_format', {
    check: "name ~ '^[a-z0-9]+(-[a-z0-9]+)*$'"
  })

  // Seed with initial flags. dual-channel defaults to true to match the godot-explorer
  // client default (LiveKit redundancy while Pulse is established).
  pgm.sql(`
    INSERT INTO feature_flags (name, enabled, description) VALUES
      ('pulse', false, 'Enable the ENet/UDP avatar-relay transport (Pulse) in godot-explorer'),
      ('dual-channel', true, 'Keep sending movement over LiveKit while Pulse is established')
  `)
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('feature_flags')
}
