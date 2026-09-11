import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

// Server-sent push notifications for the mobile explorer.
// See decentraland/godot-explorer#2585.
//
// Everything is prefixed `push_` because `campaigns` is already taken by the ad-token ->
// scene mapping, which is a different thing with a colliding name.
//
// The audience is NOT stored as a query: mobile-bff knows nothing about users. Targeting
// happens in the warehouse (Segment identify traits -> Snowflake `users` table), and the
// resolved list is uploaded per campaign as (user_id, token) pairs. That keeps this service
// a delivery channel rather than a second source of truth about who our users are.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('push_campaigns', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    // Kebab-case, same style as feature_flags and the deep-link params. Travels in the
    // deeplink as `push_campaign_id`, and is the join key back from the `Push Opened`
    // Segment event, so it has to be stable and human-chosen rather than the uuid.
    campaign_key: { type: 'text', notNull: true, unique: true },
    title: { type: 'text', notNull: true },
    body: { type: 'text', notNull: true },
    // Always a decentraland:// link. Composed by the backoffice, which appends
    // push_campaign_id / push_id / source=push so a PM never writes them by hand.
    deep_link: { type: 'text', notNull: true },
    image_url: { type: 'text', notNull: false },
    // One category in v1 (`liveops`), which maps to the Android channel of the same name.
    category: { type: 'text', notNull: true, default: 'liveops' },
    status: { type: 'text', notNull: true, default: 'draft' },
    // How long FCM should keep trying. Without an explicit TTL it retains for up to four
    // weeks, so a Saturday event could surface on Tuesday.
    ttl_seconds: { type: 'integer', notNull: true, default: 86400 },
    // NULL means "send as soon as it is approved".
    scheduled_at: { type: 'timestamptz', notNull: false },
    audience_count: { type: 'integer', notNull: true, default: 0 },
    // Wallet addresses, lowercase. Audit trail, same as feature_flags.updated_by.
    created_by: { type: 'text', notNull: true },
    approved_by: { type: 'text', notNull: false },
    approved_at: { type: 'timestamptz', notNull: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    started_at: { type: 'timestamptz', notNull: false },
    finished_at: { type: 'timestamptz', notNull: false }
  })

  pgm.addConstraint('push_campaigns', 'push_campaigns_key_format', {
    check: "campaign_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(campaign_key) <= 64"
  })

  pgm.addConstraint('push_campaigns', 'push_campaigns_status_check', {
    check: "status IN ('draft', 'pending_approval', 'scheduled', 'sending', 'sent', 'cancelled', 'failed')"
  })

  pgm.addConstraint('push_campaigns', 'push_campaigns_deep_link_scheme', {
    check: "deep_link LIKE 'decentraland://%'"
  })

  // FCM caps TTL at 4 weeks; anything longer is silently clamped, so refuse it here
  // instead of storing a number that does not mean what it says.
  pgm.addConstraint('push_campaigns', 'push_campaigns_ttl_range', {
    check: 'ttl_seconds > 0 AND ttl_seconds <= 2419200'
  })

  // Two-man rule: whoever created a campaign cannot be the one who approves it.
  // Enforced here as well as in the handler so it holds even if a future endpoint forgets.
  pgm.addConstraint('push_campaigns', 'push_campaigns_approver_differs', {
    check: 'approved_by IS NULL OR approved_by <> created_by'
  })

  // The work queue. Rows are claimed with FOR UPDATE ... SKIP LOCKED, which is what makes
  // several replicas safe without Redis or a distributed lock.
  pgm.createTable('push_deliveries', {
    campaign_id: {
      type: 'uuid',
      notNull: true,
      references: 'push_campaigns',
      onDelete: 'CASCADE'
    },
    // analytics_user_id from the warehouse — per install, not per account.
    user_id: { type: 'text', notNull: true },
    token: { type: 'text', notNull: true },
    state: { type: 'text', notNull: true, default: 'pending' },
    provider_msg_id: { type: 'text', notNull: false },
    error_code: { type: 'text', notNull: false },
    attempts: { type: 'smallint', notNull: true, default: 0 },
    sent_at: { type: 'timestamptz', notNull: false }
  })

  pgm.addConstraint('push_deliveries', 'push_deliveries_pkey', {
    primaryKey: ['campaign_id', 'user_id']
  })

  pgm.addConstraint('push_deliveries', 'push_deliveries_state_check', {
    check: "state IN ('pending', 'sent', 'failed', 'skipped_dead_token', 'cancelled')"
  })

  // The dispatcher's claim query filters on exactly this pair.
  pgm.createIndex('push_deliveries', ['campaign_id', 'state'])

  // Tokens FCM has told us are gone (UNREGISTERED / INVALID_ARGUMENT). Populated from send
  // responses and subtracted when the next audience is resolved, so a stale CSV export does
  // not keep paying for sends that cannot land.
  pgm.createTable('push_dead_tokens', {
    token: { type: 'text', primaryKey: true },
    error_code: { type: 'text', notNull: true },
    seen_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('push_dead_tokens')
  pgm.dropTable('push_deliveries')
  pgm.dropTable('push_campaigns')
}
