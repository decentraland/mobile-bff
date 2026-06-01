import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

// IAP (Apple StoreKit) consumable credit purchases. One row per verified
// StoreKit transaction. The user's balance is derived from this table
// (SUM of granted credits minus refunded ones) — there is no separate
// balance column to keep as the single source of truth and avoid drift.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('iap_transactions', {
    // Apple's transactionId — globally unique per purchase. PRIMARY KEY gives
    // us idempotency for free: Apple delivers the same tx twice (purchase +
    // Transaction.updates) and the webhook can race the client, so every
    // grant path does INSERT ... ON CONFLICT DO NOTHING.
    transaction_id: { type: 'text', primaryKey: true },
    // Groups a tx with its original purchase (refunds reference the original).
    original_transaction_id: { type: 'text', notNull: true },
    // Lowercased wallet address that owns the credits.
    wallet: { type: 'text', notNull: true },
    product_id: { type: 'text', notNull: true },
    credits: { type: 'integer', notNull: true },
    // 'Sandbox' | 'Production' — never let a Sandbox tx credit Production.
    environment: { type: 'text', notNull: true },
    // 'granted' | 'refunded'. Refunds (via webhook) flip this; the balance
    // query only counts 'granted'.
    status: { type: 'text', notNull: true, default: 'granted' },
    // Apple's purchaseDate — used for the per-day spend limit.
    purchase_date: { type: 'timestamptz', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') }
  })

  // Balance and daily-spend queries both filter by wallet + status.
  pgm.createIndex('iap_transactions', ['wallet', 'status'])
  // Daily limit reads a wallet's grants within a day window.
  pgm.createIndex('iap_transactions', ['wallet', 'purchase_date'])
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('iap_transactions')
}
