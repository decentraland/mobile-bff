import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('campaigns', {
    // Opaque token carried by the ad / referrer link as `?c=<token>`. Deliberately
    // NOT the destination: a deep link carrying position/realm boots godot-explorer
    // straight into the explorer, skipping avatar creation and the FTUE this feature
    // is about (see _should_go_to_explorer_from_deeplink in lobby.gd).
    token: { type: 'text', primaryKey: true },
    target_type: { type: 'text', notNull: true },
    // Genesis City parcel as "x,y"
    target_position: { type: 'text', notNull: false },
    // World name, e.g. "name.dcl.eth"
    target_world: { type: 'text', notNull: false }
  })

  // Same kebab-case style as feature_flags and the godot-explorer deep-link params
  pgm.addConstraint('campaigns', 'campaigns_token_format', {
    check: "token ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(token) <= 64"
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
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('campaigns')
}
