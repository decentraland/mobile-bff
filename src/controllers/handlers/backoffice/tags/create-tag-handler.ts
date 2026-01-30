import { DecentralandSignatureContext } from '@dcl/platform-crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { isAllowedUser } from '../../../../logic/allowed-users'

interface CreateTagBody {
  name: string
  description?: string
}

export async function createTagHandler(
  context: HandlerContextWithPath<'tagsDb' | 'logs' | 'config', '/backoffice/tags'> & DecentralandSignatureContext<any>
) {
  const {
    components: { tagsDb, logs, config },
    verification,
    request
  } = context

  const logger = logs.getLogger('create-tag')
  const userAddress = verification?.auth

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
    const body = await request.json() as CreateTagBody

    // Validate required fields
    if (!body.name || typeof body.name !== 'string') {
      return {
        status: 400,
        body: { ok: false, error: 'Missing or invalid required field: name' }
      }
    }

    const normalizedName = body.name.toLowerCase().trim()
    if (normalizedName.length === 0 || normalizedName.length > 100) {
      return {
        status: 400,
        body: { ok: false, error: 'Tag name must be between 1 and 100 characters' }
      }
    }

    // Check if tag already exists
    const existing = await tagsDb.getTagByName(normalizedName)
    if (existing) {
      return {
        status: 409,
        body: { ok: false, error: 'Tag already exists' }
      }
    }

    const tag = await tagsDb.createTag(normalizedName, body.description)
    logger.info('Tag created', { id: tag.id, name: tag.name, createdBy: userAddress })

    return {
      status: 201,
      body: {
        ok: true,
        data: tag
      }
    }
  } catch (error) {
    const errorMessage = (error as Error).message

    // Check for unique constraint violation
    if (errorMessage.includes('duplicate key') || errorMessage.includes('unique constraint')) {
      return {
        status: 409,
        body: { ok: false, error: 'Tag already exists' }
      }
    }

    logger.error('Error creating tag', { error: errorMessage, createdBy: userAddress })
    return {
      status: 500,
      body: { ok: false, error: 'Internal server error' }
    }
  }
}
