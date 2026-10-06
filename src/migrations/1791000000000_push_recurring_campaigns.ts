import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

// What a campaign needs to be fed by the warehouse instead of by a one-off CSV.
// See decentraland/godot-explorer#2945.
//
// A lifecycle campaign is never finished: the audience feed names a different set of installs
// every day, because the trigger is "this install's third day", not a date someone picked. Two
// things in the original schema assumed the opposite.
//
// The first is the campaign's own lifecycle. A drained queue meant `sent`, and a `sent`
// campaign is invisible to the dispatcher's claim, so tomorrow's rows would sit in `pending`
// for good. `is_recurring` splits the two meanings of an empty queue: finished, or idle until
// the next ingest.
//
// The second is that the message was entirely a property of the campaign. D3 sends every
// install back to the location it actually played, so the destination belongs to the row, not
// to the campaign, and so does the instant it should go out: 19:00 in the install's own
// timezone is a different moment for each one.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumns('push_campaigns', {
    is_recurring: { type: 'boolean', notNull: true, default: false }
  })

  pgm.addColumns('push_deliveries', {
    // Overrides the campaign's for this row. The campaign's value stays the fallback, so a
    // campaign whose audience is uploaded by hand needs no per-row data at all.
    deep_link: { type: 'text', notNull: false },
    image_url: { type: 'text', notNull: false },
    // When this row may be sent. NULL means "as soon as the campaign allows", which is how
    // every hand-uploaded row behaves. A value in the past is sent immediately: that is what
    // a row whose moment passed while nobody read the feed is supposed to do.
    send_at: { type: 'timestamptz', notNull: false }
  })

  pgm.addConstraint('push_deliveries', 'push_deliveries_deep_link_scheme', {
    check: "deep_link IS NULL OR deep_link LIKE 'decentraland://%'"
  })

  // The claim filters on campaign_id + state and now also on send_at, and takes the batch in
  // index order with no sort (see claimDeliveries). Carrying send_at as the third column keeps
  // the filter inside the index and, within one campaign, hands back the rows that came due
  // first. The two-column index this replaces is a prefix of it, so nothing else regresses.
  pgm.dropIndex('push_deliveries', ['campaign_id', 'state'])
  pgm.createIndex('push_deliveries', ['campaign_id', 'state', 'send_at'])
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropIndex('push_deliveries', ['campaign_id', 'state', 'send_at'])
  pgm.createIndex('push_deliveries', ['campaign_id', 'state'])
  pgm.dropConstraint('push_deliveries', 'push_deliveries_deep_link_scheme')
  pgm.dropColumns('push_deliveries', ['deep_link', 'image_url', 'send_at'])
  pgm.dropColumns('push_campaigns', ['is_recurring'])
}
