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
  createdAt: number
  updatedAt: number
}

export type CreateSceneGroupInput = {
  name: string
  description?: string
  color: string
  tags?: string[]
  parcels: ParcelCoord[]
}

export type UpdateSceneGroupInput = {
  name?: string
  description?: string
  color?: string
  tags?: string[]
  parcels?: ParcelCoord[]
}

export type ISceneGroupsDbComponent = {
  getAllSceneGroups(): Promise<SceneGroup[]>
  getSceneGroupById(id: string): Promise<SceneGroup | null>
  getSceneGroupByParcel(x: number, y: number): Promise<SceneGroup | null>
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
      createdAt: new Date(row.createdAt).getTime(),
      updatedAt: new Date(row.updatedAt).getTime()
    }
  }

  async function getAllSceneGroups(): Promise<SceneGroup[]> {
    const query = SQL`
      SELECT
        sg.id,
        sg.name,
        sg.description,
        sg.color,
        sg.tags,
        sg.created_at as "createdAt",
        sg.updated_at as "updatedAt",
        COALESCE(json_agg(json_build_object('x', sgp.x, 'y', sgp.y)) FILTER (WHERE sgp.x IS NOT NULL), '[]') as parcels
      FROM scene_groups sg
      LEFT JOIN scene_group_parcels sgp ON sg.id = sgp.scene_group_id
      GROUP BY sg.id
      ORDER BY sg.created_at DESC
    `
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
        sg.tags,
        sg.created_at as "createdAt",
        sg.updated_at as "updatedAt",
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
        sg.tags,
        sg.created_at as "createdAt",
        sg.updated_at as "updatedAt",
        COALESCE(json_agg(json_build_object('x', sgp.x, 'y', sgp.y)) FILTER (WHERE sgp.x IS NOT NULL), '[]') as parcels
      FROM scene_groups sg
      JOIN scene_group_parcels sgp ON sg.id = sgp.scene_group_id
      WHERE sg.id = (SELECT scene_group_id FROM scene_group_parcels WHERE x = ${x} AND y = ${y})
      GROUP BY sg.id
    `
    const result = await pg.query<SceneGroupRow>(query)
    return result.rows.length > 0 ? toSceneGroup(result.rows[0]) : null
  }

  async function createSceneGroup(input: CreateSceneGroupInput): Promise<SceneGroup> {
    const insertGroupQuery = SQL`
      INSERT INTO scene_groups (name, description, color, tags)
      VALUES (
        ${input.name},
        ${input.description || ''},
        ${input.color},
        ${input.tags || []}
      )
      RETURNING id
    `
    const groupResult = await pg.query<{ id: string }>(insertGroupQuery)
    const groupId = groupResult.rows[0].id

    if (input.parcels.length > 0) {
      const values = input.parcels.map(p => `('${groupId}', ${p.x}, ${p.y})`).join(', ')
      const insertParcelsQuery = SQL``
      insertParcelsQuery.append(`INSERT INTO scene_group_parcels (scene_group_id, x, y) VALUES ${values}`)
      await pg.query(insertParcelsQuery)
    }

    return (await getSceneGroupById(groupId))!
  }

  async function updateSceneGroup(id: string, input: UpdateSceneGroupInput): Promise<SceneGroup | null> {
    // Use COALESCE to keep existing values for fields not provided
    const updateQuery = SQL`
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
    const result = await pg.query<{ id: string }>(updateQuery)

    if (result.rows.length === 0) return null

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
    createSceneGroup,
    updateSceneGroup,
    deleteSceneGroup
  }
}
