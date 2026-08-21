import { DecentralandSignatureContext } from '@dcl/crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { isAllowedUser } from '../../../../logic/allowed-users'
import { CreatePlaceGroupInput } from '../../../../adapters/place-groups-db'

export async function createPlaceGroupHandler(
  context: HandlerContextWithPath<'placeGroupsDb' | 'logs' | 'config', '/backoffice/place-groups'> & DecentralandSignatureContext<any>
) {
  const {
    components: { placeGroupsDb, logs, config },
    verification,
    request
  } = context

  const logger = logs.getLogger('create-place-group')
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
    const body = await request.json() as CreatePlaceGroupInput

    // Validate required fields
    if (!body.name || typeof body.name !== 'string') {
      return {
        status: 400,
        body: { ok: false, error: 'Missing or invalid required field: name' }
      }
    }

    if (!body.color || typeof body.color !== 'string') {
      return {
        status: 400,
        body: { ok: false, error: 'Missing or invalid required field: color' }
      }
    }

    // Validate color format
    if (!/^#[0-9A-Fa-f]{6}$/.test(body.color)) {
      return {
        status: 400,
        body: { ok: false, error: 'Invalid color format. Use #RRGGBB' }
      }
    }

    const group = await placeGroupsDb.createPlaceGroup(body)
    logger.info('Place group created', { id: group.id, createdBy: userAddress })

    return {
      status: 201,
      body: {
        ok: true,
        data: group
      }
    }
  } catch (error) {
    logger.error('Error creating place group', { error: (error as Error).message, createdBy: userAddress })
    return {
      status: 500,
      body: { ok: false, error: 'Internal server error' }
    }
  }
}
