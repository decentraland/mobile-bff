import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('campaigns', {
    // Opaque token carried by the ad / referrer link as `?c=<token>`. Deliberately
    // NOT the destination: a deep link carrying position/realm boots godot-explorer
    // straight into the explorer, skipping avatar creation and the FTUE this feature
    // is about (see _should_go_to_explorer_from_deeplink in lobby.gd).
    token: { type: 'text', primaryKey: true },
    // 'ftue'   -> the FTUE renders campaign content with the target pinned first
    // 'bypass' -> skip the FTUE and boot straight into the target's loading screen
    mode: { type: 'text', notNull: true, default: 'ftue' },
    target_type: { type: 'text', notNull: true },
    // Genesis City parcel as "x,y"
    target_position: { type: 'text', notNull: false },
    // World name, e.g. "name.dcl.eth"
    target_world: { type: 'text', notNull: false },
    // Optional FTUE copy overrides ('ftue' mode only)
    title: { type: 'text', notNull: false },
    cta: { type: 'text', notNull: false },
    // Curated carousel. Empty -> the default featured list, with the target pinned first.
    place_ids: { type: 'text[]', notNull: true, default: pgm.func("'{}'") },
    starts_at: { type: 'timestamptz', notNull: false },
    ends_at: { type: 'timestamptz', notNull: false },
    enabled: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_by: { type: 'varchar(64)', notNull: false }
  })

  // Same kebab-case style as feature_flags and the godot-explorer deep-link params
  pgm.addConstraint('campaigns', 'campaigns_token_format', {
    check: "token ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(token) <= 64"
  })

  pgm.addConstraint('campaigns', 'campaigns_mode_check', {
    check: "mode IN ('ftue', 'bypass')"
  })

  pgm.addConstraint('campaigns', 'campaigns_target_type_check', {
    check: "target_type IN ('genesis', 'world')"
  })

  // Exactly one target column is populated, matching target_type
  pgm.addConstraint('campaigns', 'campaigns_target_by_type', {
    check: `
      (target_type = 'genesis' AND target_position IS NOT NULL AND target_world IS NULL)
      OR
      (target_type = 'world' AND target_world IS NOT NULL AND target_position IS NULL)
    `
  })

  // "x,y" with optional minus signs — the format Global.async_teleport_to expects
  pgm.addConstraint('campaigns', 'campaigns_position_format', {
    check: "target_position IS NULL OR target_position ~ '^-?[0-9]{1,4},-?[0-9]{1,4}$'"
  })

  pgm.addConstraint('campaigns', 'campaigns_window_order', {
    check: 'starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at'
  })

  // The public GET filters on enabled + window on every client boot
  pgm.createIndex('campaigns', ['enabled', 'starts_at', 'ends_at'], {
    name: 'campaigns_active_idx'
  })

  // Audit trail. No FK to campaigns: the history of a deleted campaign must survive it.
  pgm.createTable('campaign_audit', {
    id: { type: 'serial', primaryKey: true },
    token: { type: 'text', notNull: true },
    action: { type: 'text', notNull: true },
    // Full row snapshot for create/delete, changed fields only for update
    changes: { type: 'jsonb', notNull: false },
    actor: { type: 'varchar(64)', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') }
  })

  pgm.addConstraint('campaign_audit', 'campaign_audit_action_check', {
    check: "action IN ('create', 'update', 'delete')"
  })

  pgm.createIndex('campaign_audit', ['token', 'created_at'], {
    name: 'campaign_audit_token_created_idx'
  })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('campaign_audit')
  pgm.dropTable('campaigns')
}
