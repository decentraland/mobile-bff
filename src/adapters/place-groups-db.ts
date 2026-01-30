import SQL from 'sql-template-strings'
import { AppComponents } from '../types'

export type PlaceGroup = {
  id: string
  name: string
  description: string
  color: string
  placeCount: number
  tags: string[]  // Aggregated from places' tags
  createdAt: number
  updatedAt: number
}

export type CreatePlaceGroupInput = {
  name: string
  description?: string
  color: string
}

export type UpdatePlaceGroupInput = {
  name?: string
  description?: string
  color?: string
}

export type IPlaceGroupsDbComponent = {
  getAllPlaceGroups(): Promise<PlaceGroup[]>
  getPlaceGroupById(id: string): Promise<PlaceGroup | null>
  createPlaceGroup(input: CreatePlaceGroupInput): Promise<PlaceGroup>
  updatePlaceGroup(id: string, input: UpdatePlaceGroupInput): Promise<PlaceGroup | null>
  deletePlaceGroup(id: string): Promise<boolean>
}

type PlaceGroupRow = {
  id: string
  name: string
  description: string
  color: string
  placeCount: number
  tags: string[]
  createdAt: Date
  updatedAt: Date
}

export async function createPlaceGroupsDbComponent({ pg }: Pick<AppComponents, 'pg'>): Promise<IPlaceGroupsDbComponent> {

  function toPlaceGroup(row: PlaceGroupRow): PlaceGroup {
    return {
      id: row.id,
      name: row.name,
      description: row.description || '',
      color: row.color,
      placeCount: row.placeCount || 0,
      tags: row.tags || [],
      createdAt: new Date(row.createdAt).getTime(),
      updatedAt: new Date(row.updatedAt).getTime()
    }
  }

  async function getAllPlaceGroups(): Promise<PlaceGroup[]> {
    const query = SQL`
      SELECT
        pg.id,
        pg.name,
        pg.description,
        pg.color,
        pg.created_at as "createdAt",
        pg.updated_at as "updatedAt",
        COUNT(DISTINCT p.id)::int as "placeCount",
        COALESCE(
          (SELECT array_agg(DISTINCT t.name ORDER BY t.name)
           FROM places p2
           JOIN place_tags pt ON pt.place_id = p2.id
           JOIN tags t ON t.id = pt.tag_id
           WHERE p2.group_id = pg.id),
          '{}'
        ) as tags
      FROM place_groups pg
      LEFT JOIN places p ON p.group_id = pg.id
      GROUP BY pg.id
      ORDER BY pg.created_at DESC
    `
    const result = await pg.query<PlaceGroupRow>(query)
    return result.rows.map(toPlaceGroup)
  }

  async function getPlaceGroupById(id: string): Promise<PlaceGroup | null> {
    const query = SQL`
      SELECT
        pg.id,
        pg.name,
        pg.description,
        pg.color,
        pg.created_at as "createdAt",
        pg.updated_at as "updatedAt",
        COUNT(DISTINCT p.id)::int as "placeCount",
        COALESCE(
          (SELECT array_agg(DISTINCT t.name ORDER BY t.name)
           FROM places p2
           JOIN place_tags pt ON pt.place_id = p2.id
           JOIN tags t ON t.id = pt.tag_id
           WHERE p2.group_id = pg.id),
          '{}'
        ) as tags
      FROM place_groups pg
      LEFT JOIN places p ON p.group_id = pg.id
      WHERE pg.id = ${id}
      GROUP BY pg.id
    `
    const result = await pg.query<PlaceGroupRow>(query)
    return result.rows.length > 0 ? toPlaceGroup(result.rows[0]) : null
  }

  async function createPlaceGroup(input: CreatePlaceGroupInput): Promise<PlaceGroup> {
    const insertQuery = SQL`
      INSERT INTO place_groups (name, description, color)
      VALUES (
        ${input.name},
        ${input.description || ''},
        ${input.color}
      )
      RETURNING id
    `
    const result = await pg.query<{ id: string }>(insertQuery)
    const groupId = result.rows[0].id
    return (await getPlaceGroupById(groupId))!
  }

  async function updatePlaceGroup(id: string, input: UpdatePlaceGroupInput): Promise<PlaceGroup | null> {
    const updateQuery = SQL`
      UPDATE place_groups
      SET
        name = COALESCE(${input.name ?? null}, name),
        description = COALESCE(${input.description ?? null}, description),
        color = COALESCE(${input.color ?? null}, color),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING id
    `
    const result = await pg.query<{ id: string }>(updateQuery)

    if (result.rows.length === 0) return null
    return getPlaceGroupById(id)
  }

  async function deletePlaceGroup(id: string): Promise<boolean> {
    const query = SQL`DELETE FROM place_groups WHERE id = ${id}`
    const result = await pg.query(query)
    return (result.rowCount ?? 0) > 0
  }

  return {
    getAllPlaceGroups,
    getPlaceGroupById,
    createPlaceGroup,
    updatePlaceGroup,
    deletePlaceGroup
  }
}
