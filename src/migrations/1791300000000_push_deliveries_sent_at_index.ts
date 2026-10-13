import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

// The sends-per-day view reads the send log by `sent_at` with no campaign in the predicate, and
// the only index on push_deliveries leads with campaign_id. That was a sequential scan of the
// whole log on every panel load, over a table that gains a row per push per install every day
// the warehouse feed runs. Partial on `state = 'sent'`, which is the only state that carries
// a sent_at and the only one the view reads.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createIndex('push_deliveries', ['sent_at'], {
    name: 'push_deliveries_sent_at_index',
    where: "state = 'sent'"
  })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropIndex('push_deliveries', ['sent_at'], { name: 'push_deliveries_sent_at_index' })
}
