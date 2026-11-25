import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    INSERT INTO tags (name, description) VALUES
      ('banned', 'Hidden from Discover on Android and iOS')
    ON CONFLICT (name) DO NOTHING
  `)
}

export async function down(): Promise<void> {}
