import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumns('feature_flags', {
    type: { type: 'text', notNull: true, default: 'on-off' },
    value: { type: 'text', notNull: false }
  })

  pgm.addConstraint('feature_flags', 'feature_flags_type_check', {
    check: "type IN ('on-off', 'text', 'number')"
  })

  // on-off flags carry no value; text/number flags always carry one
  pgm.addConstraint('feature_flags', 'feature_flags_value_by_type', {
    check: "(type = 'on-off' AND value IS NULL) OR (type IN ('text', 'number') AND value IS NOT NULL)"
  })

  // number values are plain decimals (no scientific notation) so clients can
  // parse them with a simple to_float
  pgm.addConstraint('feature_flags', 'feature_flags_number_value_format', {
    check: "type <> 'number' OR value ~ '^-?[0-9]+(\\.[0-9]+)?$'"
  })

  pgm.sql(`
    INSERT INTO feature_flags (name, type, value, description) VALUES
      ('sentry-sample-rate', 'number', '1', 'Sentry error sample rate for godot-explorer (0..1, e.g. 1, 0.1)'),
      ('sentry-traces-sample-rate', 'number', '0.1', 'Sentry performance traces sample rate for godot-explorer (0..1)')
  `)
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Text/number flags are meaningless without the value column
  pgm.sql("DELETE FROM feature_flags WHERE type <> 'on-off'")
  pgm.dropConstraint('feature_flags', 'feature_flags_number_value_format')
  pgm.dropConstraint('feature_flags', 'feature_flags_value_by_type')
  pgm.dropConstraint('feature_flags', 'feature_flags_type_check')
  pgm.dropColumns('feature_flags', ['type', 'value'])
}
