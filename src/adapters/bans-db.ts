import SQL from 'sql-template-strings'
import { AppComponents } from '../types'

export type Ban = {
  id: string
  groupId: string | null  // If set, it's a group ban
  worldName: string | null  // If set, it's a world ban
  placeId: string | null  // If set, it's a place ban
  positions: string[]  // For scene bans, the positions that identify the scene ("x,y" format)
  sceneId: string | null  // Entity/scene ID at ban time (for detecting redeploys)
  reason?: string
  createdBy: string
  createdAt: number
}

export type CreateGroupBanInput = {
  groupId: string
  reason?: string
}

export type CreateSceneBanInput = {
  positions: string[]  // ["x,y", "x,y"] format
  sceneId?: string  // Entity ID of the scene at ban time
  reason?: string
}

export type CreateWorldBanInput = {
  worldName: string
  sceneId?: string  // Entity ID of the world at ban time
  reason?: string
}

export type CreatePlaceBanInput = {
  placeId: string
  sceneId?: string  // Entity ID at ban time
  reason?: string
}

export type IBansDbComponent = {
  getAllBans(): Promise<Ban[]>
  getBanById(id: string): Promise<Ban | null>
  getBanByGroupId(groupId: string): Promise<Ban | null>
  getBanByPosition(position: string): Promise<Ban | null>
  getBanByWorldName(worldName: string): Promise<Ban | null>
  getBanByPlaceId(placeId: string): Promise<Ban | null>
  createGroupBan(input: CreateGroupBanInput, createdBy: string): Promise<Ban>
  createSceneBan(input: CreateSceneBanInput, createdBy: string): Promise<Ban>
  createWorldBan(input: CreateWorldBanInput, createdBy: string): Promise<Ban>
  createPlaceBan(input: CreatePlaceBanInput, createdBy: string): Promise<Ban>
  deleteBan(id: string): Promise<boolean>
}

type BanRow = {
  id: string
  groupId: string | null
  worldName: string | null
  placeId: string | null
  positions: string[] | null
  sceneId: string | null
  reason: string | null
  createdBy: string
  createdAt: Date
}

export async function createBansDbComponent({ pg }: Pick<AppComponents, 'pg'>): Promise<IBansDbComponent> {

  function toBan(row: BanRow): Ban {
    return {
      id: row.id,
      groupId: row.groupId,
      worldName: row.worldName,
      placeId: row.placeId,
      positions: row.positions || [],
      sceneId: row.sceneId,
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
        b.world_name as "worldName",
        b.place_id as "placeId",
        b.scene_id as "sceneId",
        b.reason,
        b.created_by as "createdBy",
        b.created_at as "createdAt",
        COALESCE(array_agg(bp.position) FILTER (WHERE bp.position IS NOT NULL), '{}') as positions
      FROM bans b
      LEFT JOIN ban_positions bp ON b.id = bp.ban_id
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
        b.world_name as "worldName",
        b.place_id as "placeId",
        b.scene_id as "sceneId",
        b.reason,
        b.created_by as "createdBy",
        b.created_at as "createdAt",
        COALESCE(array_agg(bp.position) FILTER (WHERE bp.position IS NOT NULL), '{}') as positions
      FROM bans b
      LEFT JOIN ban_positions bp ON b.id = bp.ban_id
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
        b.world_name as "worldName",
        b.place_id as "placeId",
        b.scene_id as "sceneId",
        b.reason,
        b.created_by as "createdBy",
        b.created_at as "createdAt",
        '{}' as positions
      FROM bans b
      WHERE b.group_id = ${groupId}
    `
    const result = await pg.query<BanRow>(query)
    return result.rows.length > 0 ? toBan(result.rows[0]) : null
  }

  async function getBanByWorldName(worldName: string): Promise<Ban | null> {
    const query = SQL`
      SELECT
        b.id,
        b.group_id as "groupId",
        b.world_name as "worldName",
        b.place_id as "placeId",
        b.scene_id as "sceneId",
        b.reason,
        b.created_by as "createdBy",
        b.created_at as "createdAt",
        '{}' as positions
      FROM bans b
      WHERE b.world_name = ${worldName}
    `
    const result = await pg.query<BanRow>(query)
    return result.rows.length > 0 ? toBan(result.rows[0]) : null
  }

  async function getBanByPosition(position: string): Promise<Ban | null> {
    const query = SQL`
      SELECT
        b.id,
        b.group_id as "groupId",
        b.world_name as "worldName",
        b.place_id as "placeId",
        b.scene_id as "sceneId",
        b.reason,
        b.created_by as "createdBy",
        b.created_at as "createdAt",
        COALESCE(
          (SELECT array_agg(bp2.position)
           FROM ban_positions bp2 WHERE bp2.ban_id = b.id),
          '{}'
        ) as positions
      FROM ban_positions bp
      JOIN bans b ON bp.ban_id = b.id
      WHERE bp.position = ${position}
        AND b.group_id IS NULL AND b.world_name IS NULL AND b.place_id IS NULL
      LIMIT 1
    `
    const result = await pg.query<BanRow>(query)
    return result.rows.length > 0 ? toBan(result.rows[0]) : null
  }

  async function getBanByPlaceId(placeId: string): Promise<Ban | null> {
    const query = SQL`
      SELECT
        b.id,
        b.group_id as "groupId",
        b.world_name as "worldName",
        b.place_id as "placeId",
        b.scene_id as "sceneId",
        b.reason,
        b.created_by as "createdBy",
        b.created_at as "createdAt",
        '{}' as positions
      FROM bans b
      WHERE b.place_id = ${placeId}
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
    if (input.positions.length === 0) {
      throw new Error('Scene ban requires at least one position')
    }

    // Use a transaction to ensure atomicity
    await pg.query(SQL`BEGIN`)

    try {
      const insertBanQuery = SQL`
        INSERT INTO bans (group_id, scene_id, reason, created_by)
        VALUES (NULL, ${input.sceneId || null}, ${input.reason || null}, ${createdBy})
        RETURNING id
      `
      const banResult = await pg.query<{ id: string }>(insertBanQuery)
      const banId = banResult.rows[0].id

      // Insert positions
      for (const position of input.positions) {
        await pg.query(SQL`
          INSERT INTO ban_positions (ban_id, position)
          VALUES (${banId}, ${position})
        `)
      }

      await pg.query(SQL`COMMIT`)

      return (await getBanById(banId))!
    } catch (error) {
      await pg.query(SQL`ROLLBACK`)
      throw error
    }
  }

  async function createWorldBan(input: CreateWorldBanInput, createdBy: string): Promise<Ban> {
    const insertBanQuery = SQL`
      INSERT INTO bans (world_name, scene_id, reason, created_by)
      VALUES (${input.worldName}, ${input.sceneId || null}, ${input.reason || null}, ${createdBy})
      RETURNING id
    `
    const banResult = await pg.query<{ id: string }>(insertBanQuery)
    const banId = banResult.rows[0].id

    return (await getBanById(banId))!
  }

  async function createPlaceBan(input: CreatePlaceBanInput, createdBy: string): Promise<Ban> {
    const insertBanQuery = SQL`
      INSERT INTO bans (place_id, scene_id, reason, created_by)
      VALUES (${input.placeId}, ${input.sceneId || null}, ${input.reason || null}, ${createdBy})
      RETURNING id
    `
    const banResult = await pg.query<{ id: string }>(insertBanQuery)
    const banId = banResult.rows[0].id

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
    getBanByPosition,
    getBanByWorldName,
    getBanByPlaceId,
    createGroupBan,
    createSceneBan,
    createWorldBan,
    createPlaceBan,
    deleteBan
  }
}
