import { DecentralandSignatureContext } from '@dcl/platform-crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { isAllowedUser } from '../../../../logic/allowed-users'
import { UpdateSceneGroupInput } from '../../../../adapters/scene-groups-db'

export async function updateSceneGroupHandler(
  context: HandlerContextWithPath<'sceneGroupsDb' | 'logs' | 'config', '/backoffice/scene-groups/:id'> & DecentralandSignatureContext<any>
) {
  const {
    components: { sceneGroupsDb, logs, config },
    verification,
    request,
    params
  } = context

  const logger = logs.getLogger('update-scene-group')
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
    const body = await request.json() as UpdateSceneGroupInput

    // Validate color format if provided
    if (body.color !== undefined && !/^#[0-9A-Fa-f]{6}$/.test(body.color)) {
      return {
        status: 400,
        body: { ok: false, error: 'Invalid color format. Use #RRGGBB' }
      }
    }

    // Validate parcels structure if provided
    if (body.parcels !== undefined) {
      if (!Array.isArray(body.parcels)) {
        return {
          status: 400,
          body: { ok: false, error: 'Invalid parcels format. Expected array of {x: number, y: number}' }
        }
      }

      for (const parcel of body.parcels) {
        if (typeof parcel.x !== 'number' || typeof parcel.y !== 'number') {
          return {
            status: 400,
            body: { ok: false, error: 'Invalid parcels format. Expected array of {x: number, y: number}' }
          }
        }
      }
    }

    // Validate worldName if provided (can be null to clear it)
    if (body.worldName !== undefined && body.worldName !== null && typeof body.worldName !== 'string') {
      return {
        status: 400,
        body: { ok: false, error: 'Invalid worldName format. Expected string or null' }
      }
    }

    const group = await sceneGroupsDb.updateSceneGroup(id, body)

    if (!group) {
      return {
        status: 404,
        body: { ok: false, error: 'Scene group not found' }
      }
    }

    logger.info('Scene group updated', { id, updatedBy: userAddress })

    return {
      status: 200,
      body: {
        ok: true,
        data: group
      }
    }
  } catch (error) {
    const errorMessage = (error as Error).message

    // Check for unique constraint violation (parcel already in another group)
    if (errorMessage.includes('duplicate key') || errorMessage.includes('unique constraint')) {
      return {
        status: 409,
        body: { ok: false, error: 'One or more parcels already belong to another scene group' }
      }
    }

    logger.error('Error updating scene group', { error: errorMessage, id, updatedBy: userAddress })
    return {
      status: 500,
      body: { ok: false, error: 'Internal server error' }
    }
  }
}
