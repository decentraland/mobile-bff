import SQL from 'sql-template-strings'
import { AppComponents } from '../types'

export type DeletionRequest = {
  id: number
  userAddress: string
  requestedAt: Date
  cancelledAt: Date | null
  status: 'pending' | 'cancelled'
}

export type IDbComponent = {
  getDeletionRequest(userAddress: string): Promise<DeletionRequest | null>
  createDeletionRequest(userAddress: string): Promise<DeletionRequest>
  cancelDeletionRequest(userAddress: string): Promise<DeletionRequest | null>
}

export async function createDbComponent({ pg }: Pick<AppComponents, 'pg'>): Promise<IDbComponent> {
  async function getDeletionRequest(userAddress: string): Promise<DeletionRequest | null> {
    const query = SQL`
      SELECT
        id,
        user_address as "userAddress",
        requested_at as "requestedAt",
        cancelled_at as "cancelledAt",
        status
      FROM deletion_requests
      WHERE user_address = ${userAddress.toLowerCase()}
    `
    const result = await pg.query<DeletionRequest>(query)
    return result.rows[0] || null
  }

  async function createDeletionRequest(userAddress: string): Promise<DeletionRequest> {
    const query = SQL`
      INSERT INTO deletion_requests (user_address, status)
      VALUES (${userAddress.toLowerCase()}, 'pending')
      ON CONFLICT (user_address)
      DO UPDATE SET
        requested_at = NOW(),
        cancelled_at = NULL,
        status = 'pending'
      RETURNING
        id,
        user_address as "userAddress",
        requested_at as "requestedAt",
        cancelled_at as "cancelledAt",
        status
    `
    const result = await pg.query<DeletionRequest>(query)
    return result.rows[0]
  }

  async function cancelDeletionRequest(userAddress: string): Promise<DeletionRequest | null> {
    const query = SQL`
      UPDATE deletion_requests
      SET cancelled_at = NOW(), status = 'cancelled'
      WHERE user_address = ${userAddress.toLowerCase()} AND status = 'pending'
      RETURNING
        id,
        user_address as "userAddress",
        requested_at as "requestedAt",
        cancelled_at as "cancelledAt",
        status
    `
    const result = await pg.query<DeletionRequest>(query)
    return result.rows[0] || null
  }

  return {
    getDeletionRequest,
    createDeletionRequest,
    cancelDeletionRequest
  }
}
