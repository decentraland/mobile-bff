import SQL from 'sql-template-strings'
import { AppComponents } from '../types'

export type ParcelCoord = {
  x: number
  y: number
}

export type Ban = {
  id: string
  groupId: string | null  // If set, it's a group ban; if null, it's a scene ban
  parcels: ParcelCoord[]  // For scene bans, the parcels that identify the scene
  reason?: string
  createdBy: string
  createdAt: number
}

export type CreateGroupBanInput = {
  groupId: string
  reason?: string
}

export type CreateSceneBanInput = {
  parcels: ParcelCoord[]
  reason?: string
}

export type IBansDbComponent = {
  getAllBans(): Promise<Ban[]>
  getBanById(id: string): Promise<Ban | null>
  getBanByGroupId(groupId: string): Promise<Ban | null>
  getBanByParcels(parcels: ParcelCoord[]): Promise<Ban | null>
  createGroupBan(input: CreateGroupBanInput, createdBy: string): Promise<Ban>
  createSceneBan(input: CreateSceneBanInput, createdBy: string): Promise<Ban>
  deleteBan(id: string): Promise<boolean>
}

type BanRow = {
  id: string
  groupId: string | null
  parcels: ParcelCoord[] | null
  reason: string | null
  createdBy: string
  createdAt: Date
}

// Generate a unique key from parcels for lookups
function generateParcelKey(parcels: ParcelCoord[]): string {
  return parcels.map(p => `${p.x},${p.y}`).sort().join('|')
}

export async function createBansDbComponent({ pg }: Pick<AppComponents, 'pg'>): Promise<IBansDbComponent> {

  function toBan(row: BanRow): Ban {
    return {
      id: row.id,
      groupId: row.groupId,
      parcels: row.parcels || [],
      reason: row.reason || undefined,
      createdBy: row.createdBy,
      createdAt: new Date(row.createdAt).getTime()
    }
  }

  async function getAllBans(): Promise<Ban[]> {
    const query = SQL`
      SELECT
        b.id,
        b.group_id as "groupId",
        b.reason,
        b.created_by as "createdBy",
        b.created_at as "createdAt",
        COALESCE(json_agg(json_build_object('x', bp.x, 'y', bp.y)) FILTER (WHERE bp.x IS NOT NULL), '[]') as parcels
      FROM bans b
      LEFT JOIN ban_parcels bp ON b.id = bp.ban_id
      GROUP BY b.id
      ORDER BY b.created_at DESC
    `
    const result = await pg.query<BanRow>(query)
    return result.rows.map(toBan)
  }

  async function getBanById(id: string): Promise<Ban | null> {
    const query = SQL`
      SELECT
        b.id,
        b.group_id as "groupId",
        b.reason,
        b.created_by as "createdBy",
        b.created_at as "createdAt",
        COALESCE(json_agg(json_build_object('x', bp.x, 'y', bp.y)) FILTER (WHERE bp.x IS NOT NULL), '[]') as parcels
      FROM bans b
      LEFT JOIN ban_parcels bp ON b.id = bp.ban_id
      WHERE b.id = ${id}
      GROUP BY b.id
    `
    const result = await pg.query<BanRow>(query)
    return result.rows.length > 0 ? toBan(result.rows[0]) : null
  }

  async function getBanByGroupId(groupId: string): Promise<Ban | null> {
    const query = SQL`
      SELECT
        b.id,
        b.group_id as "groupId",
        b.reason,
        b.created_by as "createdBy",
        b.created_at as "createdAt",
        '[]'::json as parcels
      FROM bans b
      WHERE b.group_id = ${groupId}
    `
    const result = await pg.query<BanRow>(query)
    return result.rows.length > 0 ? toBan(result.rows[0]) : null
  }

  async function getBanByParcels(parcels: ParcelCoord[]): Promise<Ban | null> {
    if (parcels.length === 0) return null

    // Find scene bans (group_id IS NULL) that have matching parcels
    // We need to match the exact set of parcels
    const parcelKey = generateParcelKey(parcels)

    const query = SQL`
      SELECT
        b.id,
        b.group_id as "groupId",
        b.reason,
        b.created_by as "createdBy",
        b.created_at as "createdAt",
        COALESCE(json_agg(json_build_object('x', bp.x, 'y', bp.y)) FILTER (WHERE bp.x IS NOT NULL), '[]') as parcels
      FROM bans b
      LEFT JOIN ban_parcels bp ON b.id = bp.ban_id
      WHERE b.group_id IS NULL
      GROUP BY b.id
      HAVING string_agg(bp.x || ',' || bp.y, '|' ORDER BY bp.x, bp.y) = ${parcelKey}
    `
    const result = await pg.query<BanRow>(query)
    return result.rows.length > 0 ? toBan(result.rows[0]) : null
  }

  async function createGroupBan(input: CreateGroupBanInput, createdBy: string): Promise<Ban> {
    const insertBanQuery = SQL`
      INSERT INTO bans (group_id, reason, created_by)
      VALUES (${input.groupId}, ${input.reason || null}, ${createdBy})
      RETURNING id
    `
    const banResult = await pg.query<{ id: string }>(insertBanQuery)
    const banId = banResult.rows[0].id

    return (await getBanById(banId))!
  }

  async function createSceneBan(input: CreateSceneBanInput, createdBy: string): Promise<Ban> {
    if (input.parcels.length === 0) {
      throw new Error('Scene ban requires at least one parcel')
    }

    const insertBanQuery = SQL`
      INSERT INTO bans (group_id, reason, created_by)
      VALUES (NULL, ${input.reason || null}, ${createdBy})
      RETURNING id
    `
    const banResult = await pg.query<{ id: string }>(insertBanQuery)
    const banId = banResult.rows[0].id

    // Insert parcels
    const values = input.parcels.map(p => `('${banId}', ${p.x}, ${p.y})`).join(', ')
    const insertParcelsQuery = SQL``
    insertParcelsQuery.append(`INSERT INTO ban_parcels (ban_id, x, y) VALUES ${values}`)
    await pg.query(insertParcelsQuery)

    return (await getBanById(banId))!
  }

  async function deleteBan(id: string): Promise<boolean> {
    const query = SQL`DELETE FROM bans WHERE id = ${id}`
    const result = await pg.query(query)
    return (result.rowCount ?? 0) > 0
  }

  return {
    getAllBans,
    getBanById,
    getBanByGroupId,
    getBanByParcels,
    createGroupBan,
    createSceneBan,
    deleteBan
  }
}
