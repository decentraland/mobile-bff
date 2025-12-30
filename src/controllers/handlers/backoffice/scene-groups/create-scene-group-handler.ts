import { DecentralandSignatureContext } from '@dcl/platform-crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { isAllowedUser } from '../../../../logic/allowed-users'
import { CreateSceneGroupInput } from '../../../../adapters/scene-groups-db'

export async function createSceneGroupHandler(
  context: HandlerContextWithPath<'sceneGroupsDb' | 'logs' | 'config', '/backoffice/scene-groups'> & DecentralandSignatureContext<any>
) {
  const {
    components: { sceneGroupsDb, logs, config },
    verification,
    request
  } = context

  const logger = logs.getLogger('create-scene-group')
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
    const body = await request.json() as CreateSceneGroupInput

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

    if (!body.parcels || !Array.isArray(body.parcels)) {
      return {
        status: 400,
        body: { ok: false, error: 'Missing or invalid required field: parcels' }
      }
    }

    // Validate color format
    if (!/^#[0-9A-Fa-f]{6}$/.test(body.color)) {
      return {
        status: 400,
        body: { ok: false, error: 'Invalid color format. Use #RRGGBB' }
      }
    }

    // Validate parcels structure
    for (const parcel of body.parcels) {
      if (typeof parcel.x !== 'number' || typeof parcel.y !== 'number') {
        return {
          status: 400,
          body: { ok: false, error: 'Invalid parcels format. Expected array of {x: number, y: number}' }
        }
      }
    }

    const group = await sceneGroupsDb.createSceneGroup(body)
    logger.info('Scene group created', { id: group.id, createdBy: userAddress })

    return {
      status: 201,
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

    logger.error('Error creating scene group', { error: errorMessage, createdBy: userAddress })
    return {
      status: 500,
      body: { ok: false, error: 'Internal server error' }
    }
  }
}
