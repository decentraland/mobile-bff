import SQL from 'sql-template-strings'
import { AppComponents } from '../types'

export type ParcelCoord = {
  x: number
  y: number
}

export type SceneGroup = {
  id: string
  name: string
  description: string
  color: string
  tags: string[]
  parcels: ParcelCoord[]
  worldName: string | null
  createdAt: number
  updatedAt: number
}

export type CreateSceneGroupInput = {
  name: string
  description?: string
  color: string
  tags?: string[]
  parcels?: ParcelCoord[]
  worldName?: string
}

export type UpdateSceneGroupInput = {
  name?: string
  description?: string
  color?: string
  tags?: string[]
  parcels?: ParcelCoord[]
  worldName?: string | null
}

export type ISceneGroupsDbComponent = {
  getAllSceneGroups(tagFilters?: string[]): Promise<SceneGroup[]>
  getSceneGroupById(id: string): Promise<SceneGroup | null>
  getSceneGroupByParcel(x: number, y: number): Promise<SceneGroup | null>
  getSceneGroupByWorldName(worldName: string): Promise<SceneGroup | null>
  createSceneGroup(input: CreateSceneGroupInput): Promise<SceneGroup>
  updateSceneGroup(id: string, input: UpdateSceneGroupInput): Promise<SceneGroup | null>
  deleteSceneGroup(id: string): Promise<boolean>
}

type SceneGroupRow = {
  id: string
  name: string
  description: string
  color: string
  tags: string[]
  parcels: ParcelCoord[]
  worldName: string | null
  createdAt: Date
  updatedAt: Date
}

export async function createSceneGroupsDbComponent({ pg }: Pick<AppComponents, 'pg'>): Promise<ISceneGroupsDbComponent> {

  function toSceneGroup(row: SceneGroupRow): SceneGroup {
    return {
      id: row.id,
      name: row.name,
      description: row.description || '',
      color: row.color,
      tags: row.tags || [],
      parcels: row.parcels || [],
      worldName: row.worldName,
      createdAt: new Date(row.createdAt).getTime(),
      updatedAt: new Date(row.updatedAt).getTime()
    }
  }

  async function getAllSceneGroups(tagFilters?: string[]): Promise<SceneGroup[]> {
    const query = SQL`
      SELECT
        sg.id,
        sg.name,
        sg.description,
        sg.color,
        sg.world_name as "worldName",
        sg.created_at as "createdAt",
        sg.updated_at as "updatedAt",
        COALESCE(
          (SELECT array_agg(t.name ORDER BY t.name)
           FROM scene_group_tags sgt
           JOIN tags t ON t.id = sgt.tag_id
           WHERE sgt.group_id = sg.id),
          '{}'
        ) as tags,
        COALESCE(json_agg(json_build_object('x', sgp.x, 'y', sgp.y)) FILTER (WHERE sgp.x IS NOT NULL), '[]') as parcels
      FROM scene_groups sg
      LEFT JOIN scene_group_parcels sgp ON sg.id = sgp.scene_group_id
    `
    if (tagFilters && tagFilters.length > 0) {
      // Filter groups that have ALL specified tags
      const normalizedTags = tagFilters.map(t => t.toLowerCase())
      query.append(SQL`
        WHERE (
          SELECT COUNT(DISTINCT t.name)
          FROM scene_group_tags sgt
          JOIN tags t ON t.id = sgt.tag_id
          WHERE sgt.group_id = sg.id AND t.name = ANY(${normalizedTags})
        ) = ${normalizedTags.length}
      `)
    }
    query.append(SQL`
      GROUP BY sg.id
      ORDER BY sg.created_at DESC
    `)
    const result = await pg.query<SceneGroupRow>(query)
    return result.rows.map(toSceneGroup)
  }

  async function getSceneGroupById(id: string): Promise<SceneGroup | null> {
    const query = SQL`
      SELECT
        sg.id,
        sg.name,
        sg.description,
        sg.color,
        sg.world_name as "worldName",
        sg.created_at as "createdAt",
        sg.updated_at as "updatedAt",
        COALESCE(
          (SELECT array_agg(t.name ORDER BY t.name)
           FROM scene_group_tags sgt
           JOIN tags t ON t.id = sgt.tag_id
           WHERE sgt.group_id = sg.id),
          '{}'
        ) as tags,
        COALESCE(json_agg(json_build_object('x', sgp.x, 'y', sgp.y)) FILTER (WHERE sgp.x IS NOT NULL), '[]') as parcels
      FROM scene_groups sg
      LEFT JOIN scene_group_parcels sgp ON sg.id = sgp.scene_group_id
      WHERE sg.id = ${id}
      GROUP BY sg.id
    `
    const result = await pg.query<SceneGroupRow>(query)
    return result.rows.length > 0 ? toSceneGroup(result.rows[0]) : null
  }

  async function getSceneGroupByParcel(x: number, y: number): Promise<SceneGroup | null> {
    const query = SQL`
      SELECT
        sg.id,
        sg.name,
        sg.description,
        sg.color,
        sg.world_name as "worldName",
        sg.created_at as "createdAt",
        sg.updated_at as "updatedAt",
        COALESCE(
          (SELECT array_agg(t.name ORDER BY t.name)
           FROM scene_group_tags sgt
           JOIN tags t ON t.id = sgt.tag_id
           WHERE sgt.group_id = sg.id),
          '{}'
        ) as tags,
        COALESCE(json_agg(json_build_object('x', sgp.x, 'y', sgp.y)) FILTER (WHERE sgp.x IS NOT NULL), '[]') as parcels
      FROM scene_groups sg
      JOIN scene_group_parcels sgp ON sg.id = sgp.scene_group_id
      WHERE sg.id = (SELECT scene_group_id FROM scene_group_parcels WHERE x = ${x} AND y = ${y})
      GROUP BY sg.id
    `
    const result = await pg.query<SceneGroupRow>(query)
    return result.rows.length > 0 ? toSceneGroup(result.rows[0]) : null
  }

  async function getSceneGroupByWorldName(worldName: string): Promise<SceneGroup | null> {
    const query = SQL`
      SELECT
        sg.id,
        sg.name,
        sg.description,
        sg.color,
        sg.world_name as "worldName",
        sg.created_at as "createdAt",
        sg.updated_at as "updatedAt",
        COALESCE(
          (SELECT array_agg(t.name ORDER BY t.name)
           FROM scene_group_tags sgt
           JOIN tags t ON t.id = sgt.tag_id
           WHERE sgt.group_id = sg.id),
          '{}'
        ) as tags,
        COALESCE(json_agg(json_build_object('x', sgp.x, 'y', sgp.y)) FILTER (WHERE sgp.x IS NOT NULL), '[]') as parcels
      FROM scene_groups sg
      LEFT JOIN scene_group_parcels sgp ON sg.id = sgp.scene_group_id
      WHERE sg.world_name = ${worldName}
      GROUP BY sg.id
    `
    const result = await pg.query<SceneGroupRow>(query)
    return result.rows.length > 0 ? toSceneGroup(result.rows[0]) : null
  }

  async function createSceneGroup(input: CreateSceneGroupInput): Promise<SceneGroup> {
    // Insert the scene group (tags column kept for backward compatibility but we use junction table)
    const insertGroupQuery = SQL`
      INSERT INTO scene_groups (name, description, color, tags, world_name)
      VALUES (
        ${input.name},
        ${input.description || ''},
        ${input.color},
        ${input.tags || []},
        ${input.worldName || null}
      )
      RETURNING id
    `
    const groupResult = await pg.query<{ id: string }>(insertGroupQuery)
    const groupId = groupResult.rows[0].id

    // Insert parcels if provided
    const parcels = input.parcels || []
    if (parcels.length > 0) {
      const values = parcels.map(p => `('${groupId}', ${p.x}, ${p.y})`).join(', ')
      const insertParcelsQuery = SQL``
      insertParcelsQuery.append(`INSERT INTO scene_group_parcels (scene_group_id, x, y) VALUES ${values}`)
      await pg.query(insertParcelsQuery)
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
        // Link tag to group
        await pg.query(SQL`
          INSERT INTO scene_group_tags (group_id, tag_id)
          VALUES (${groupId}, ${tagId})
          ON CONFLICT DO NOTHING
        `)
      }
    }

    return (await getSceneGroupById(groupId))!
  }

  async function updateSceneGroup(id: string, input: UpdateSceneGroupInput): Promise<SceneGroup | null> {
    // Use COALESCE to keep existing values for fields not provided
    // Note: world_name can be explicitly set to null to clear it
    const updateQuery = SQL`
      UPDATE scene_groups
      SET
        name = COALESCE(${input.name ?? null}, name),
        description = COALESCE(${input.description ?? null}, description),
        color = COALESCE(${input.color ?? null}, color),
        tags = COALESCE(${input.tags ?? null}, tags),
        world_name = ${input.worldName !== undefined ? input.worldName : null},
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING id
    `
    // If worldName is not provided in input, don't update it
    const updateQueryWithoutWorldName = SQL`
      UPDATE scene_groups
      SET
        name = COALESCE(${input.name ?? null}, name),
        description = COALESCE(${input.description ?? null}, description),
        color = COALESCE(${input.color ?? null}, color),
        tags = COALESCE(${input.tags ?? null}, tags),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING id
    `

    const queryToUse = input.worldName !== undefined ? updateQuery : updateQueryWithoutWorldName
    const result = await pg.query<{ id: string }>(queryToUse)

    if (result.rows.length === 0) return null

    // Update parcels if provided
    if (input.parcels !== undefined) {
      const deleteQuery = SQL`DELETE FROM scene_group_parcels WHERE scene_group_id = ${id}`
      await pg.query(deleteQuery)

      if (input.parcels.length > 0) {
        const parcelValues = input.parcels.map(p => `('${id}', ${p.x}, ${p.y})`).join(', ')
        const insertParcelsQuery = SQL``
        insertParcelsQuery.append(`INSERT INTO scene_group_parcels (scene_group_id, x, y) VALUES ${parcelValues}`)
        await pg.query(insertParcelsQuery)
      }
    }

    // Update tags in junction table if provided
    if (input.tags !== undefined) {
      // Remove all existing tags
      await pg.query(SQL`DELETE FROM scene_group_tags WHERE group_id = ${id}`)

      // Add new tags
      if (input.tags.length > 0) {
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
          // Link tag to group
          await pg.query(SQL`
            INSERT INTO scene_group_tags (group_id, tag_id)
            VALUES (${id}, ${tagId})
            ON CONFLICT DO NOTHING
          `)
        }
      }
    }

    return getSceneGroupById(id)
  }

  async function deleteSceneGroup(id: string): Promise<boolean> {
    const query = SQL`DELETE FROM scene_groups WHERE id = ${id}`
    const result = await pg.query(query)
    return (result.rowCount ?? 0) > 0
  }

  return {
    getAllSceneGroups,
    getSceneGroupById,
    getSceneGroupByParcel,
    getSceneGroupByWorldName,
    createSceneGroup,
    updateSceneGroup,
    deleteSceneGroup
  }
}
