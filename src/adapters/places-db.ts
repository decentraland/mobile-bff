import SQL from 'sql-template-strings'
import { AppComponents } from '../types'

export type PlaceType = 'scene' | 'world'

export type Place = {
  id: string
  type: PlaceType
  name: string | null  // Scene/world title
  basePosition: string | null  // "x,y" format for scenes, null for worlds
  worldName: string | null
  sceneId: string | null
  groupId: string | null
  groupName: string | null
  groupColor: string | null
  tags: string[]
  positions: string[]  // ["x,y", "x,y"] format
  createdAt: number
  updatedAt: number
}

export type CreatePlaceInput = {
  type: PlaceType
  name?: string  // Scene/world title
  basePosition?: string  // "x,y" format
  worldName?: string
  sceneId?: string
  groupId?: string
  tags?: string[]
  positions?: string[]  // ["x,y", "x,y"] format
}

export type UpdatePlaceInput = {
  name?: string | null
  basePosition?: string
  worldName?: string
  sceneId?: string | null
  groupId?: string | null
  tags?: string[]
  positions?: string[]
}

export type IPlacesDbComponent = {
  getAllPlaces(tagFilters?: string[]): Promise<Place[]>
  getPlaceById(id: string): Promise<Place | null>
  getPlaceByBasePosition(position: string): Promise<Place | null>
  getPlaceByPosition(position: string): Promise<Place | null>
  getPlaceByWorldName(worldName: string): Promise<Place | null>
  getPlacesByGroupId(groupId: string): Promise<Place[]>
  createPlace(input: CreatePlaceInput): Promise<Place>
  updatePlace(id: string, input: UpdatePlaceInput): Promise<Place | null>
  deletePlace(id: string): Promise<boolean>
  setPlaceGroup(placeId: string, groupId: string | null): Promise<Place | null>
}

type PlaceRow = {
  id: string
  type: PlaceType
  name: string | null
  basePosition: string | null
  worldName: string | null
  sceneId: string | null
  groupId: string | null
  groupName: string | null
  groupColor: string | null
  tags: string[]
  positions: string[]
  createdAt: Date
  updatedAt: Date
}

export async function createPlacesDbComponent({ pg }: Pick<AppComponents, 'pg'>): Promise<IPlacesDbComponent> {

  function toPlace(row: PlaceRow): Place {
    return {
      id: row.id,
      type: row.type,
      name: row.name,
      basePosition: row.basePosition,
      worldName: row.worldName,
      sceneId: row.sceneId,
      groupId: row.groupId,
      groupName: row.groupName,
      groupColor: row.groupColor,
      tags: row.tags || [],
      positions: row.positions || [],
      createdAt: new Date(row.createdAt).getTime(),
      updatedAt: new Date(row.updatedAt).getTime()
    }
  }

  async function getAllPlaces(tagFilters?: string[]): Promise<Place[]> {
    const query = SQL`
      SELECT
        p.id,
        p.type,
        p.name,
        p.base_position as "basePosition",
        p.world_name as "worldName",
        p.scene_id as "sceneId",
        p.group_id as "groupId",
        pg.name as "groupName",
        pg.color as "groupColor",
        p.created_at as "createdAt",
        p.updated_at as "updatedAt",
        COALESCE(
          (SELECT array_agg(t.name ORDER BY t.name)
           FROM place_tags pt
           JOIN tags t ON t.id = pt.tag_id
           WHERE pt.place_id = p.id),
          '{}'
        ) as tags,
        COALESCE(array_agg(pp.position) FILTER (WHERE pp.position IS NOT NULL), '{}') as positions
      FROM places p
      LEFT JOIN place_groups pg ON p.group_id = pg.id
      LEFT JOIN place_positions pp ON p.id = pp.place_id
    `

    if (tagFilters && tagFilters.length > 0) {
      const normalizedTags = tagFilters.map(t => t.toLowerCase())
      query.append(SQL`
        WHERE (
          SELECT COUNT(DISTINCT t.name)
          FROM place_tags pt
          JOIN tags t ON t.id = pt.tag_id
          WHERE pt.place_id = p.id AND t.name = ANY(${normalizedTags})
        ) = ${normalizedTags.length}
      `)
    }

    query.append(SQL`
      GROUP BY p.id, pg.id
      ORDER BY p.created_at DESC
    `)

    const result = await pg.query<PlaceRow>(query)
    return result.rows.map(toPlace)
  }

  async function getPlaceById(id: string): Promise<Place | null> {
    const query = SQL`
      SELECT
        p.id,
        p.type,
        p.name,
        p.base_position as "basePosition",
        p.world_name as "worldName",
        p.scene_id as "sceneId",
        p.group_id as "groupId",
        pg.name as "groupName",
        pg.color as "groupColor",
        p.created_at as "createdAt",
        p.updated_at as "updatedAt",
        COALESCE(
          (SELECT array_agg(t.name ORDER BY t.name)
           FROM place_tags pt
           JOIN tags t ON t.id = pt.tag_id
           WHERE pt.place_id = p.id),
          '{}'
        ) as tags,
        COALESCE(array_agg(pp.position) FILTER (WHERE pp.position IS NOT NULL), '{}') as positions
      FROM places p
      LEFT JOIN place_groups pg ON p.group_id = pg.id
      LEFT JOIN place_positions pp ON p.id = pp.place_id
      WHERE p.id = ${id}
      GROUP BY p.id, pg.id
    `
    const result = await pg.query<PlaceRow>(query)
    return result.rows.length > 0 ? toPlace(result.rows[0]) : null
  }

  async function getPlaceByBasePosition(position: string): Promise<Place | null> {
    const query = SQL`
      SELECT
        p.id,
        p.type,
        p.name,
        p.base_position as "basePosition",
        p.world_name as "worldName",
        p.scene_id as "sceneId",
        p.group_id as "groupId",
        pg.name as "groupName",
        pg.color as "groupColor",
        p.created_at as "createdAt",
        p.updated_at as "updatedAt",
        COALESCE(
          (SELECT array_agg(t.name ORDER BY t.name)
           FROM place_tags pt
           JOIN tags t ON t.id = pt.tag_id
           WHERE pt.place_id = p.id),
          '{}'
        ) as tags,
        COALESCE(array_agg(pp.position) FILTER (WHERE pp.position IS NOT NULL), '{}') as positions
      FROM places p
      LEFT JOIN place_groups pg ON p.group_id = pg.id
      LEFT JOIN place_positions pp ON p.id = pp.place_id
      WHERE p.base_position = ${position}
      GROUP BY p.id, pg.id
    `
    const result = await pg.query<PlaceRow>(query)
    return result.rows.length > 0 ? toPlace(result.rows[0]) : null
  }

  async function getPlaceByPosition(position: string): Promise<Place | null> {
    const query = SQL`
      SELECT
        p.id,
        p.type,
        p.name,
        p.base_position as "basePosition",
        p.world_name as "worldName",
        p.scene_id as "sceneId",
        p.group_id as "groupId",
        pg.name as "groupName",
        pg.color as "groupColor",
        p.created_at as "createdAt",
        p.updated_at as "updatedAt",
        COALESCE(
          (SELECT array_agg(t.name ORDER BY t.name)
           FROM place_tags pt
           JOIN tags t ON t.id = pt.tag_id
           WHERE pt.place_id = p.id),
          '{}'
        ) as tags,
        COALESCE(array_agg(pp2.position) FILTER (WHERE pp2.position IS NOT NULL), '{}') as positions
      FROM places p
      LEFT JOIN place_groups pg ON p.group_id = pg.id
      LEFT JOIN place_positions pp2 ON p.id = pp2.place_id
      WHERE p.id = (SELECT place_id FROM place_positions WHERE position = ${position})
      GROUP BY p.id, pg.id
    `
    const result = await pg.query<PlaceRow>(query)
    return result.rows.length > 0 ? toPlace(result.rows[0]) : null
  }

  async function getPlaceByWorldName(worldName: string): Promise<Place | null> {
    const query = SQL`
      SELECT
        p.id,
        p.type,
        p.name,
        p.base_position as "basePosition",
        p.world_name as "worldName",
        p.scene_id as "sceneId",
        p.group_id as "groupId",
        pg.name as "groupName",
        pg.color as "groupColor",
        p.created_at as "createdAt",
        p.updated_at as "updatedAt",
        COALESCE(
          (SELECT array_agg(t.name ORDER BY t.name)
           FROM place_tags pt
           JOIN tags t ON t.id = pt.tag_id
           WHERE pt.place_id = p.id),
          '{}'
        ) as tags,
        '{}' as positions
      FROM places p
      LEFT JOIN place_groups pg ON p.group_id = pg.id
      WHERE p.world_name = ${worldName}
      GROUP BY p.id, pg.id
    `
    const result = await pg.query<PlaceRow>(query)
    return result.rows.length > 0 ? toPlace(result.rows[0]) : null
  }

  async function getPlacesByGroupId(groupId: string): Promise<Place[]> {
    const query = SQL`
      SELECT
        p.id,
        p.type,
        p.name,
        p.base_position as "basePosition",
        p.world_name as "worldName",
        p.scene_id as "sceneId",
        p.group_id as "groupId",
        pg.name as "groupName",
        pg.color as "groupColor",
        p.created_at as "createdAt",
        p.updated_at as "updatedAt",
        COALESCE(
          (SELECT array_agg(t.name ORDER BY t.name)
           FROM place_tags pt
           JOIN tags t ON t.id = pt.tag_id
           WHERE pt.place_id = p.id),
          '{}'
        ) as tags,
        COALESCE(array_agg(pp.position) FILTER (WHERE pp.position IS NOT NULL), '{}') as positions
      FROM places p
      LEFT JOIN place_groups pg ON p.group_id = pg.id
      LEFT JOIN place_positions pp ON p.id = pp.place_id
      WHERE p.group_id = ${groupId}
      GROUP BY p.id, pg.id
      ORDER BY p.created_at DESC
    `
    const result = await pg.query<PlaceRow>(query)
    return result.rows.map(toPlace)
  }

  async function createPlace(input: CreatePlaceInput): Promise<Place> {
    // Insert the place
    const insertPlaceQuery = SQL`
      INSERT INTO places (type, name, base_position, world_name, scene_id, group_id)
      VALUES (
        ${input.type},
        ${input.name || null},
        ${input.type === 'scene' ? input.basePosition : null},
        ${input.type === 'world' ? input.worldName : null},
        ${input.sceneId || null},
        ${input.groupId || null}
      )
      RETURNING id
    `
    const placeResult = await pg.query<{ id: string }>(insertPlaceQuery)
    const placeId = placeResult.rows[0].id

    // Insert positions if provided (for scenes)
    const positions = input.positions || []
    if (positions.length > 0) {
      const values = positions.map(pos => `('${placeId}', '${pos}')`).join(', ')
      const insertPositionsQuery = SQL``
      insertPositionsQuery.append(`INSERT INTO place_positions (place_id, position) VALUES ${values}`)
      await pg.query(insertPositionsQuery)
    }

    // Insert tags into junction table
    if (input.tags && input.tags.length > 0) {
      for (const tagName of input.tags) {
        const normalizedName = tagName.toLowerCase().trim()
        // Get or create the tag
        const tagResult = await pg.query<{ id: string }>(SQL`
          INSERT INTO tags (name)
          VALUES (${normalizedName})
          ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
          RETURNING id
        `)
        const tagId = tagResult.rows[0].id
        // Link tag to place
        await pg.query(SQL`
          INSERT INTO place_tags (place_id, tag_id)
          VALUES (${placeId}, ${tagId})
          ON CONFLICT DO NOTHING
        `)
      }
    }

    return (await getPlaceById(placeId))!
  }

  async function updatePlace(id: string, input: UpdatePlaceInput): Promise<Place | null> {
    // Use COALESCE for optional updates
    const updateQuery = SQL`
      UPDATE places
      SET
        base_position = COALESCE(${input.basePosition ?? null}, base_position),
        world_name = COALESCE(${input.worldName ?? null}, world_name),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING id
    `

    // Handle name separately since it can be explicitly set to null
    if (input.name !== undefined) {
      await pg.query(SQL`UPDATE places SET name = ${input.name} WHERE id = ${id}`)
    }

    // Handle sceneId separately since it can be explicitly set to null
    if (input.sceneId !== undefined) {
      await pg.query(SQL`UPDATE places SET scene_id = ${input.sceneId} WHERE id = ${id}`)
    }

    // Handle groupId separately since it can be explicitly set to null
    if (input.groupId !== undefined) {
      await pg.query(SQL`UPDATE places SET group_id = ${input.groupId} WHERE id = ${id}`)
    }

    const result = await pg.query<{ id: string }>(updateQuery)

    if (result.rows.length === 0) return null

    // Update positions if provided
    if (input.positions !== undefined) {
      await pg.query(SQL`DELETE FROM place_positions WHERE place_id = ${id}`)

      if (input.positions.length > 0) {
        const positionValues = input.positions.map(pos => `('${id}', '${pos}')`).join(', ')
        const insertPositionsQuery = SQL``
        insertPositionsQuery.append(`INSERT INTO place_positions (place_id, position) VALUES ${positionValues}`)
        await pg.query(insertPositionsQuery)
      }
    }

    // Update tags if provided
    if (input.tags !== undefined) {
      await pg.query(SQL`DELETE FROM place_tags WHERE place_id = ${id}`)

      if (input.tags.length > 0) {
        for (const tagName of input.tags) {
          const normalizedName = tagName.toLowerCase().trim()
          const tagResult = await pg.query<{ id: string }>(SQL`
            INSERT INTO tags (name)
            VALUES (${normalizedName})
            ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
            RETURNING id
          `)
          const tagId = tagResult.rows[0].id
          await pg.query(SQL`
            INSERT INTO place_tags (place_id, tag_id)
            VALUES (${id}, ${tagId})
            ON CONFLICT DO NOTHING
          `)
        }
      }
    }

    return getPlaceById(id)
  }

  async function deletePlace(id: string): Promise<boolean> {
    const query = SQL`DELETE FROM places WHERE id = ${id}`
    const result = await pg.query(query)
    return (result.rowCount ?? 0) > 0
  }

  async function setPlaceGroup(placeId: string, groupId: string | null): Promise<Place | null> {
    const query = SQL`
      UPDATE places
      SET group_id = ${groupId}, updated_at = NOW()
      WHERE id = ${placeId}
      RETURNING id
    `
    const result = await pg.query<{ id: string }>(query)
    if (result.rows.length === 0) return null
    return getPlaceById(placeId)
  }

  return {
    getAllPlaces,
    getPlaceById,
    getPlaceByBasePosition,
    getPlaceByPosition,
    getPlaceByWorldName,
    getPlacesByGroupId,
    createPlace,
    updatePlace,
    deletePlace,
    setPlaceGroup
  }
}
