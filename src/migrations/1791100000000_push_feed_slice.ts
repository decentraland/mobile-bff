import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

// Which slice of the warehouse audience a campaign serves, instead of the feed naming the
// campaign. See decentraland/monodata#661.
//
// The feed used to carry a `campaign_key` it composed from the trigger and the destination
// (`d3-comeback`, `d3-comeback-plaza`), which made this service's ledger key a string another
// system guessed. It was also mutable: a destination can change while a trigger is still in
// the feed's window, so the same install could arrive under a second key and be queued again
// for the same trigger. The feed now publishes the trigger and the kind of destination, and a
// campaign declares which pair it takes.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumns('push_campaigns', {
    trigger_key: { type: 'text', notNull: false },
    destination_kind: { type: 'text', notNull: false }
  })

  pgm.addConstraint('push_campaigns', 'push_campaigns_slice_check', {
    check: `
      (trigger_key IS NULL AND destination_kind IS NULL)
      OR (trigger_key IS NOT NULL AND destination_kind IN ('scene', 'plaza', 'discover'))
    `
  })

  // One *live* campaign per slice. Two taking the same pair would each queue the same install,
  // and the guard on push_deliveries would then silently drop whichever ingested second. A
  // cancelled or failed campaign is excluded, because update only touches drafts: cancelling is
  // the only lever on a live campaign, and a cancelled one holding its slice for good would
  // make "fix the copy and re-author" need a hand-written DELETE to free it.
  pgm.createIndex('push_campaigns', ['trigger_key', 'destination_kind'], {
    name: 'push_campaigns_slice_unique',
    unique: true,
    where: "trigger_key IS NOT NULL AND status NOT IN ('cancelled', 'failed')"
  })

  pgm.addColumns('push_deliveries', {
    // Copied from the campaign at ingest rather than read through it, so the guard below
    // still holds if a campaign's slice is edited afterwards.
    trigger_key: { type: 'text', notNull: false },
    // The destination's catalogue id. The thumbnail is resolved from it when the push is
    // sent rather than carried from the warehouse, so a row written three days earlier does
    // not ship a stale image.
    place_id: { type: 'text', notNull: false }
  })

  // One send per install per lifecycle trigger, whichever campaign serves it. This is what
  // makes a destination that changes mid-window unable to produce a second push.
  //
  // A cancelled delivery is excluded, and the predicate is what makes that work: a row leaves
  // the index when it is cancelled, which frees the trigger again. Otherwise pulling the kill
  // switch on a campaign would burn that trigger for every install that was queued at the
  // time, from any campaign, for good.
  pgm.createIndex('push_deliveries', ['user_id', 'trigger_key'], {
    name: 'push_deliveries_user_trigger_unique',
    unique: true,
    where: "trigger_key IS NOT NULL AND state <> 'cancelled'"
  })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropIndex('push_deliveries', ['user_id', 'trigger_key'], { name: 'push_deliveries_user_trigger_unique' })
  pgm.dropColumns('push_deliveries', ['trigger_key', 'place_id'])
  pgm.dropIndex('push_campaigns', ['trigger_key', 'destination_kind'], { name: 'push_campaigns_slice_unique' })
  pgm.dropConstraint('push_campaigns', 'push_campaigns_slice_check')
  pgm.dropColumns('push_campaigns', ['trigger_key', 'destination_kind'])
}
