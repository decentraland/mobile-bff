import { DecentralandSignatureContext } from '@dcl/crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { isAllowedUser } from '../../../../logic/allowed-users'

export async function deleteTagHandler(
  context: HandlerContextWithPath<'tagsDb' | 'logs' | 'config', '/backoffice/tags/:id'> & DecentralandSignatureContext<any>
) {
  const {
    components: { tagsDb, logs, config },
    verification,
    params
  } = context

  const logger = logs.getLogger('delete-tag')
  const userAddress = verification?.auth
  const { id } = params

  if (!userAddress) {
    return {
      status: 401,
      body: { ok: false, error: 'Unauthorized' }
    }
  }

  if (!(await isAllowedUser(config, userAddress))) {
    return {
      status: 403,
      body: { ok: false, error: 'Forbidden: User not in allowed list' }
    }
  }

  try {
    // Check if tag exists
    const tag = await tagsDb.getTagById(id)
    if (!tag) {
      return {
        status: 404,
        body: { ok: false, error: 'Tag not found' }
      }
    }

    const deleted = await tagsDb.deleteTag(id)
    if (!deleted) {
      return {
        status: 404,
        body: { ok: false, error: 'Tag not found' }
      }
    }

    logger.info('Tag deleted', { id, name: tag.name, deletedBy: userAddress })

    return {
      status: 200,
      body: {
        ok: true,
        data: { id }
      }
    }
  } catch (error) {
    const errorMessage = (error as Error).message
    logger.error('Error deleting tag', { error: errorMessage, id, deletedBy: userAddress })
    return {
      status: 500,
      body: { ok: false, error: 'Internal server error' }
    }
  }
}
