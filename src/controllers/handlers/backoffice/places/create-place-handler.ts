import { DecentralandSignatureContext } from '@dcl/platform-crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { isAllowedUser } from '../../../../logic/allowed-users'
import { CreatePlaceInput } from '../../../../adapters/places-db'

// Helper to validate position string format
function isValidPosition(position: string): boolean {
  const parts = position.split(',')
  if (parts.length !== 2) return false
  const x = parseInt(parts[0], 10)
  const y = parseInt(parts[1], 10)
  return !isNaN(x) && !isNaN(y)
}

export async function createPlaceHandler(
  context: HandlerContextWithPath<'placesDb' | 'logs' | 'config', '/backoffice/places'> & DecentralandSignatureContext<any>
) {
  const {
    components: { placesDb, logs, config },
    verification,
    request
  } = context

  const logger = logs.getLogger('create-place')
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
    const body = await request.json() as CreatePlaceInput

    // Validate required fields
    if (!body.type || (body.type !== 'scene' && body.type !== 'world')) {
      return {
        status: 400,
        body: { ok: false, error: 'Missing or invalid required field: type (must be "scene" or "world")' }
      }
    }

    // Validate scene-specific fields
    if (body.type === 'scene') {
      if (!body.basePosition || typeof body.basePosition !== 'string') {
        return {
          status: 400,
          body: { ok: false, error: 'Scene type requires basePosition (string in "x,y" format)' }
        }
      }
      if (!isValidPosition(body.basePosition)) {
        return {
          status: 400,
          body: { ok: false, error: 'Invalid basePosition format. Expected "x,y" where x and y are integers' }
        }
      }
    }

    // Validate world-specific fields
    if (body.type === 'world') {
      if (!body.worldName || typeof body.worldName !== 'string') {
        return {
          status: 400,
          body: { ok: false, error: 'World type requires worldName' }
        }
      }
    }

    // Validate positions array if provided
    if (body.positions && Array.isArray(body.positions)) {
      for (const position of body.positions) {
        if (typeof position !== 'string' || !isValidPosition(position)) {
          return {
            status: 400,
            body: { ok: false, error: 'Invalid positions format. Expected array of "x,y" strings' }
          }
        }
      }
    }

    // Validate tags if provided
    if (body.tags && !Array.isArray(body.tags)) {
      return {
        status: 400,
        body: { ok: false, error: 'Tags must be an array of strings' }
      }
    }

    const place = await placesDb.createPlace(body)
    logger.info('Place created', { id: place.id, type: place.type, createdBy: userAddress })

    return {
      status: 201,
      body: {
        ok: true,
        data: place
      }
    }
  } catch (error) {
    const errorMessage = (error as Error).message

    // Check for unique constraint violation
    if (errorMessage.includes('duplicate key') || errorMessage.includes('unique constraint')) {
      if (errorMessage.includes('place_positions')) {
        return {
          status: 409,
          body: { ok: false, error: 'One or more positions already belong to another place' }
        }
      }
      if (errorMessage.includes('world_name') || errorMessage.includes('places_world_name')) {
        return {
          status: 409,
          body: { ok: false, error: 'A place with this world name already exists' }
        }
      }
      if (errorMessage.includes('base_position') || errorMessage.includes('places_base_position')) {
        return {
          status: 409,
          body: { ok: false, error: 'A place with this base position already exists' }
        }
      }
      return {
        status: 409,
        body: { ok: false, error: 'A place with these coordinates already exists' }
      }
    }

    logger.error('Error creating place', { error: errorMessage, createdBy: userAddress })
    return {
      status: 500,
      body: { ok: false, error: 'Internal server error' }
    }
  }
}
