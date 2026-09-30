import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'
import { DEVICE_SUPPORT_SEED_DATA } from './data/device-support-seed-data'

export const shorthands: ColumnDefinitions | undefined = undefined

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('device_soc_support', {
    soc_model: { type: 'text', primaryKey: true },
    decision: { type: 'text', notNull: true },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_by: { type: 'varchar(64)', notNull: false }
  })

  pgm.addConstraint('device_soc_support', 'device_soc_support_decision_check', {
    check: "decision IN ('exclude', 'below-minspec')"
  })

  // soc_key normalizes both case and whitespace (UPPER + space-stripped), matching
  // logic/device-support.ts's toSocKey exactly, so DB-enforced uniqueness holds regardless of
  // which spelling/casing a given write used -- upsert/bulkUpsert/delete all match on this
  // column instead of re-deriving the normalization in SQL. A real stored column (not an
  // expression index) so ON CONFLICT can target a plain column name.
  pgm.sql(`
    ALTER TABLE device_soc_support
      ADD COLUMN soc_key text GENERATED ALWAYS AS (UPPER(REPLACE(TRIM(soc_model), ' ', ''))) STORED
  `)
  pgm.sql(`
    CREATE UNIQUE INDEX device_soc_support_soc_key_idx ON device_soc_support (soc_key)
  `)

  // Seed data lives in device-support-seed-data.ts (see that file for provenance/update policy).
  // The untargeted ON CONFLICT DO NOTHING guards only against this migration being re-applied to
  // an already-seeded database (e.g. a reset local/CI run); it is not an update mechanism.
  const values = DEVICE_SUPPORT_SEED_DATA.map(
    (entry) => `(${sqlLiteral(entry.soc)}, ${sqlLiteral(entry.decision)})`
  ).join(',\n    ')
  pgm.sql(`
INSERT INTO device_soc_support (soc_model, decision) VALUES
    ${values}
  ON CONFLICT DO NOTHING
  `)
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('device_soc_support')
}
