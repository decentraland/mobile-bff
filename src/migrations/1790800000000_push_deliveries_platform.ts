import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

// Which transport delivers the row: `android` goes to FCM, `ios` to APNs. Every row that
// exists predates iOS support and was sent through FCM, hence the default.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumns('push_deliveries', {
    platform: { type: 'text', notNull: true, default: 'android' }
  })
  pgm.addConstraint('push_deliveries', 'push_deliveries_platform_check', {
    check: "platform IN ('android', 'ios')"
  })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropColumns('push_deliveries', ['platform'])
}
