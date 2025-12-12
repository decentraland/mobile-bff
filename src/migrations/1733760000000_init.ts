import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('deletion_requests', {
    id: { type: 'serial', primaryKey: true },
    user_address: { type: 'varchar(42)', notNull: true, unique: true },
    requested_at: { type: 'timestamp', notNull: true, default: pgm.func('NOW()') },
    cancelled_at: { type: 'timestamp', notNull: false },
    status: { type: 'varchar(20)', notNull: true, default: "'pending'" }
  })

  pgm.createIndex('deletion_requests', 'user_address')
  pgm.createIndex('deletion_requests', 'status')
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('deletion_requests')
}
