import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

// A campaign that claims a slice of the audience feed is one the feed refills, so it has to be
// recurring. The request validator holds that when both arrive together, but an update that
// says only `isRecurring: false` leaves the stored slice where it is, and the result was a
// one-shot campaign holding a slice: never fed, closed as `sent` the first time it drained, and
// keeping the pair from any replacement until somebody cancelled it. The constraint is what
// sees the stored row and the request at once.
const SLICE_CHECK = `
  (trigger_key IS NULL AND destination_kind IS NULL)
  OR (is_recurring AND trigger_key IS NOT NULL AND destination_kind IN ('scene', 'plaza', 'discover'))
`

const PREVIOUS_SLICE_CHECK = `
  (trigger_key IS NULL AND destination_kind IS NULL)
  OR (trigger_key IS NOT NULL AND destination_kind IN ('scene', 'plaza', 'discover'))
`

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.dropConstraint('push_campaigns', 'push_campaigns_slice_check')
  pgm.addConstraint('push_campaigns', 'push_campaigns_slice_check', { check: SLICE_CHECK })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropConstraint('push_campaigns', 'push_campaigns_slice_check')
  pgm.addConstraint('push_campaigns', 'push_campaigns_slice_check', { check: PREVIOUS_SLICE_CHECK })
}
