import SQL from 'sql-template-strings'
import { AppComponents } from '../types'

export type Tag = {
  id: string
  name: string
  description: string | null
  createdAt: number
}

export type ITagsDbComponent = {
  // Tag CRUD
  getAllTags(): Promise<Tag[]>
  getTagByName(name: string): Promise<Tag | null>
  getTagById(id: string): Promise<Tag | null>
  createTag(name: string, description?: string): Promise<Tag>
  deleteTag(id: string): Promise<boolean>

  // Scene-group tag operations
  getTagsForGroup(groupId: string): Promise<Tag[]>
  addTagToGroup(groupId: string, tagId: string): Promise<void>
  removeTagFromGroup(groupId: string, tagId: string): Promise<void>
  setGroupTags(groupId: string, tagNames: string[]): Promise<void>

  // Utility
  getOrCreateTagByName(name: string): Promise<Tag>
}

type TagRow = {
  id: string
  name: string
  description: string | null
  created_at: Date
}

export async function createTagsDbComponent({ pg }: Pick<AppComponents, 'pg'>): Promise<ITagsDbComponent> {

  function toTag(row: TagRow): Tag {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      createdAt: new Date(row.created_at).getTime()
    }
  }

  async function getAllTags(): Promise<Tag[]> {
    const query = SQL`
      SELECT id, name, description, created_at
      FROM tags
      ORDER BY name ASC
    `
    const result = await pg.query<TagRow>(query)
    return result.rows.map(toTag)
  }

  async function getTagByName(name: string): Promise<Tag | null> {
    const query = SQL`
      SELECT id, name, description, created_at
      FROM tags
      WHERE name = ${name.toLowerCase()}
    `
    const result = await pg.query<TagRow>(query)
    return result.rows.length > 0 ? toTag(result.rows[0]) : null
  }

  async function getTagById(id: string): Promise<Tag | null> {
    const query = SQL`
      SELECT id, name, description, created_at
      FROM tags
      WHERE id = ${id}
    `
    const result = await pg.query<TagRow>(query)
    return result.rows.length > 0 ? toTag(result.rows[0]) : null
  }

  async function createTag(name: string, description?: string): Promise<Tag> {
    const query = SQL`
      INSERT INTO tags (name, description)
      VALUES (${name.toLowerCase()}, ${description || null})
      RETURNING id, name, description, created_at
    `
    const result = await pg.query<TagRow>(query)
    return toTag(result.rows[0])
  }

  async function deleteTag(id: string): Promise<boolean> {
    const query = SQL`DELETE FROM tags WHERE id = ${id}`
    const result = await pg.query(query)
    return (result.rowCount ?? 0) > 0
  }

  async function getTagsForGroup(groupId: string): Promise<Tag[]> {
    const query = SQL`
      SELECT t.id, t.name, t.description, t.created_at
      FROM tags t
      JOIN scene_group_tags sgt ON sgt.tag_id = t.id
      WHERE sgt.group_id = ${groupId}
      ORDER BY t.name ASC
    `
    const result = await pg.query<TagRow>(query)
    return result.rows.map(toTag)
  }

  async function addTagToGroup(groupId: string, tagId: string): Promise<void> {
    const query = SQL`
      INSERT INTO scene_group_tags (group_id, tag_id)
      VALUES (${groupId}, ${tagId})
      ON CONFLICT DO NOTHING
    `
    await pg.query(query)
  }

  async function removeTagFromGroup(groupId: string, tagId: string): Promise<void> {
    const query = SQL`
      DELETE FROM scene_group_tags
      WHERE group_id = ${groupId} AND tag_id = ${tagId}
    `
    await pg.query(query)
  }

  async function getOrCreateTagByName(name: string): Promise<Tag> {
    const normalizedName = name.toLowerCase().trim()
    const existing = await getTagByName(normalizedName)
    if (existing) return existing
    return createTag(normalizedName)
  }

  async function setGroupTags(groupId: string, tagNames: string[]): Promise<void> {
    // First, remove all existing tags for the group
    const deleteQuery = SQL`DELETE FROM scene_group_tags WHERE group_id = ${groupId}`
    await pg.query(deleteQuery)

    // If no tags to set, we're done
    if (tagNames.length === 0) return

    // Get or create tags and add them to the group
    for (const tagName of tagNames) {
      const tag = await getOrCreateTagByName(tagName)
      await addTagToGroup(groupId, tag.id)
    }
  }

  return {
    getAllTags,
    getTagByName,
    getTagById,
    createTag,
    deleteTag,
    getTagsForGroup,
    addTagToGroup,
    removeTagFromGroup,
    setGroupTags,
    getOrCreateTagByName
  }
}
