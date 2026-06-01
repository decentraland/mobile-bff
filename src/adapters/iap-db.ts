import SQL from 'sql-template-strings'
import { AppComponents } from '../types'

export type IapBalance = {
  // Sum of granted (non-refunded) credits for the wallet.
  balance: number
  // Granted credits whose purchase_date falls on the current UTC day.
  dailyConsumed: number
}

export type GrantInput = {
  transactionId: string
  originalTransactionId: string
  wallet: string
  productId: string
  credits: number
  environment: string
  purchaseDate: Date
}

// Shape consumed by the client's credits history UI.
export type IapHistoryEntry = {
  credits: number
  is_refund: boolean
  timestamp: string // YYYY.MM.DD in UTC
  product_id: string
  transaction_id: string
}

export type IIapDbComponent = {
  getBalance(wallet: string): Promise<IapBalance>
  // Idempotent: returns true if this transaction was newly inserted, false if
  // it was already recorded (duplicate delivery / webhook-client race).
  recordGrant(input: GrantInput): Promise<{ inserted: boolean }>
  // Flips a transaction to 'refunded'. Returns true if a row was updated.
  markRefunded(transactionId: string): Promise<boolean>
  // Wallet's transactions, most recent first, for the credits history view.
  getTransactions(wallet: string): Promise<IapHistoryEntry[]>
}

export async function createIapDbComponent({ pg }: Pick<AppComponents, 'pg'>): Promise<IIapDbComponent> {
  async function getBalance(wallet: string): Promise<IapBalance> {
    const w = wallet.toLowerCase()
    const query = SQL`
      SELECT
        COALESCE(SUM(credits) FILTER (WHERE status = 'granted'), 0) AS "balance",
        COALESCE(
          SUM(credits) FILTER (
            WHERE status = 'granted'
            -- Compare UTC calendar dates explicitly. purchase_date is
            -- timestamptz; converting both sides AT TIME ZONE 'UTC' and casting
            -- to ::date makes the day boundary independent of the DB session
            -- TimeZone (a bare timestamp comparison would coerce via session tz).
            AND (purchase_date AT TIME ZONE 'UTC')::date = (NOW() AT TIME ZONE 'UTC')::date
          ),
          0
        ) AS "dailyConsumed"
      FROM iap_transactions
      WHERE wallet = ${w}
    `
    const result = await pg.query<{ balance: string | number; dailyConsumed: string | number }>(query)
    const row = result.rows[0]
    return {
      balance: Number(row?.balance ?? 0),
      dailyConsumed: Number(row?.dailyConsumed ?? 0)
    }
  }

  async function recordGrant(input: GrantInput): Promise<{ inserted: boolean }> {
    const query = SQL`
      INSERT INTO iap_transactions (
        transaction_id,
        original_transaction_id,
        wallet,
        product_id,
        credits,
        environment,
        status,
        purchase_date
      ) VALUES (
        ${input.transactionId},
        ${input.originalTransactionId},
        ${input.wallet.toLowerCase()},
        ${input.productId},
        ${input.credits},
        ${input.environment},
        'granted',
        ${input.purchaseDate.toISOString()}
      )
      ON CONFLICT (transaction_id) DO NOTHING
      RETURNING transaction_id
    `
    const result = await pg.query<{ transaction_id: string }>(query)
    return { inserted: result.rowCount > 0 }
  }

  async function markRefunded(transactionId: string): Promise<boolean> {
    const query = SQL`
      UPDATE iap_transactions
      SET status = 'refunded', updated_at = NOW()
      WHERE transaction_id = ${transactionId} AND status = 'granted'
      RETURNING transaction_id
    `
    const result = await pg.query<{ transaction_id: string }>(query)
    return result.rowCount > 0
  }

  async function getTransactions(wallet: string): Promise<IapHistoryEntry[]> {
    const w = wallet.toLowerCase()
    const query = SQL`
      SELECT
        credits,
        (status = 'refunded') AS "is_refund",
        to_char(purchase_date AT TIME ZONE 'UTC', 'YYYY.MM.DD') AS "timestamp",
        product_id AS "product_id",
        transaction_id AS "transaction_id"
      FROM iap_transactions
      WHERE wallet = ${w}
      ORDER BY purchase_date DESC
    `
    const result = await pg.query<IapHistoryEntry>(query)
    return result.rows.map((r) => ({ ...r, credits: Number(r.credits) }))
  }

  return { getBalance, recordGrant, markRefunded, getTransactions }
}
