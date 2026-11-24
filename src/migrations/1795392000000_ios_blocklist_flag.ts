import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

// On: iOS Discover shows everything except blocked content (casino category, A/R rating, places
// tagged `banned_ios`). Off: the legacy allow-list, only places tagged `allowed_ios`.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    INSERT INTO feature_flags (name, enabled, description) VALUES
      ('ios-blocklist', true, 'iOS hides blocked content (casino, adult, banned_ios) instead of showing only allowed_ios places')
    ON CONFLICT (name) DO NOTHING
  `)
  pgm.sql(`
    INSERT INTO tags (name, description) VALUES
      ('banned_ios', 'Hidden from iOS Discover (porn, nudity, gambling, crypto scams)')
    ON CONFLICT (name) DO NOTHING
  `)
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DELETE FROM feature_flags WHERE name = 'ios-blocklist'`)
}
