import { DecentralandSignatureContext } from '@dcl/platform-crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { isAllowedUser } from '../../../../logic/allowed-users'

export async function setPlaceGroupHandler(
  context: HandlerContextWithPath<'placesDb' | 'placeGroupsDb' | 'logs' | 'config', '/backoffice/places/:id/group'> & DecentralandSignatureContext<any>
) {
  const {
    components: { placesDb, placeGroupsDb, logs, config },
    verification,
    request,
    params
  } = context

  const logger = logs.getLogger('set-place-group')
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
    const body = await request.json() as { groupId: string }

    if (!body.groupId || typeof body.groupId !== 'string') {
      return {
        status: 400,
        body: { ok: false, error: 'Missing or invalid required field: groupId' }
      }
    }

    // Verify group exists
    const group = await placeGroupsDb.getPlaceGroupById(body.groupId)
    if (!group) {
      return {
        status: 404,
        body: { ok: false, error: 'Place group not found' }
      }
    }

    const place = await placesDb.setPlaceGroup(id, body.groupId)

    if (!place) {
      return {
        status: 404,
        body: { ok: false, error: 'Place not found' }
      }
    }

    logger.info('Place assigned to group', { placeId: id, groupId: body.groupId, updatedBy: userAddress })

    return {
      status: 200,
      body: {
        ok: true,
        data: place
      }
    }
  } catch (error) {
    logger.error('Error assigning place to group', { error: (error as Error).message, updatedBy: userAddress })
    return {
      status: 500,
      body: { ok: false, error: 'Internal server error' }
    }
  }
}

export async function removePlaceGroupHandler(
  context: HandlerContextWithPath<'placesDb' | 'logs' | 'config', '/backoffice/places/:id/group'> & DecentralandSignatureContext<any>
) {
  const {
    components: { placesDb, logs, config },
    verification,
    params
  } = context

  const logger = logs.getLogger('remove-place-group')
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
    const place = await placesDb.setPlaceGroup(id, null)

    if (!place) {
      return {
        status: 404,
        body: { ok: false, error: 'Place not found' }
      }
    }

    logger.info('Place removed from group', { placeId: id, updatedBy: userAddress })

    return {
      status: 200,
      body: {
        ok: true,
        data: place
      }
    }
  } catch (error) {
    logger.error('Error removing place from group', { error: (error as Error).message, updatedBy: userAddress })
    return {
      status: 500,
      body: { ok: false, error: 'Internal server error' }
    }
  }
}
