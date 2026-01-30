import { HandlerContextWithPath } from '../../../types'

export async function getAllTagsHandler(
  context: HandlerContextWithPath<'tagsDb' | 'logs', '/tags'>
) {
  const {
    components: { tagsDb, logs }
  } = context

  const logger = logs.getLogger('get-all-tags')

  try {
    const tags = await tagsDb.getAllTags()

    return {
      status: 200,
      body: {
        ok: true,
        data: tags
      }
    }
  } catch (error) {
    const errorMessage = (error as Error).message
    logger.error('Error fetching tags', { error: errorMessage })
    return {
      status: 500,
      body: { ok: false, error: 'Internal server error' }
    }
  }
}
