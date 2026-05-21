import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Short-lived registration challenges. TTL is 5 minutes and entries are
  // single-shot — `consume` deletes the row in the same statement that reads
  // it. Index on expires_at to support GC sweeps.
  pgm.createTable('attest_challenges', {
    challenge: { type: 'varchar(128)', primaryKey: true },
    challenge_bytes: { type: 'bytea', notNull: true },
    expires_at: { type: 'timestamptz', notNull: true }
  })
  pgm.createIndex('attest_challenges', 'expires_at')

  // Long-lived iOS App Attest registrations. One row per install. counter is
  // the last verified assertion counter — monotonic, used for replay
  // detection. last_used_at is touched on every successful assertion so a
  // future cleanup job can purge keys that have been silent for 30+ days.
  pgm.createTable('attest_keys', {
    key_id: { type: 'varchar(128)', primaryKey: true },
    public_key_pem: { type: 'text', notNull: true },
    counter: { type: 'bigint', notNull: true, default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    last_used_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') }
  })
  pgm.createIndex('attest_keys', 'last_used_at')
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('attest_keys')
  pgm.dropTable('attest_challenges')
}
