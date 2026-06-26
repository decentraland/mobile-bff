import { DecentralandSignatureContext } from '@dcl/crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { isAllowedUser } from '../../../../logic/allowed-users'
import { UpdatePlaceGroupInput } from '../../../../adapters/place-groups-db'

export async function updatePlaceGroupHandler(
  context: HandlerContextWithPath<'placeGroupsDb' | 'logs' | 'config', '/backoffice/place-groups/:id'> & DecentralandSignatureContext<any>
) {
  const {
    components: { placeGroupsDb, logs, config },
    verification,
    request,
    params
  } = context

  const logger = logs.getLogger('update-place-group')
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
    const { id } = params
    const body = await request.json() as UpdatePlaceGroupInput

    // Validate color format if provided
    if (body.color && !/^#[0-9A-Fa-f]{6}$/.test(body.color)) {
      return {
        status: 400,
        body: { ok: false, error: 'Invalid color format. Use #RRGGBB' }
      }
    }

    const group = await placeGroupsDb.updatePlaceGroup(id, body)

    if (!group) {
      return {
        status: 404,
        body: { ok: false, error: 'Place group not found' }
      }
    }

    logger.info('Place group updated', { id: group.id, updatedBy: userAddress })

    return {
      status: 200,
      body: {
        ok: true,
        data: group
      }
    }
  } catch (error) {
    logger.error('Error updating place group', { error: (error as Error).message, updatedBy: userAddress })
    return {
      status: 500,
      body: { ok: false, error: 'Internal server error' }
    }
  }
}
