import { DecentralandSignatureContext } from '@dcl/platform-crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { isAllowedUser } from '../../../../logic/allowed-users'
import { UpdatePlaceInput } from '../../../../adapters/places-db'

// Helper to validate position string format
function isValidPosition(position: string): boolean {
  const parts = position.split(',')
  if (parts.length !== 2) return false
  const x = parseInt(parts[0], 10)
  const y = parseInt(parts[1], 10)
  return !isNaN(x) && !isNaN(y)
}

export async function updatePlaceHandler(
  context: HandlerContextWithPath<'placesDb' | 'logs' | 'config', '/backoffice/places/:id'> & DecentralandSignatureContext<any>
) {
  const {
    components: { placesDb, logs, config },
    verification,
    request,
    params
  } = context

  const logger = logs.getLogger('update-place')
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
    const body = await request.json() as UpdatePlaceInput

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

    // Validate basePosition if provided
    if (body.basePosition !== undefined && body.basePosition !== null) {
      if (typeof body.basePosition !== 'string' || !isValidPosition(body.basePosition)) {
        return {
          status: 400,
          body: { ok: false, error: 'Invalid basePosition format. Expected "x,y" where x and y are integers' }
        }
      }
    }

    // Validate tags if provided
    if (body.tags !== undefined && !Array.isArray(body.tags)) {
      return {
        status: 400,
        body: { ok: false, error: 'Tags must be an array of strings' }
      }
    }

    const place = await placesDb.updatePlace(id, body)

    if (!place) {
      return {
        status: 404,
        body: { ok: false, error: 'Place not found' }
      }
    }

    logger.info('Place updated', { id: place.id, updatedBy: userAddress })

    return {
      status: 200,
      body: {
        ok: true,
        data: place
      }
    }
  } catch (error) {
    const errorMessage = (error as Error).message

    // Check for unique constraint violation
    if (errorMessage.includes('duplicate key') || errorMessage.includes('unique constraint')) {
      return {
        status: 409,
        body: { ok: false, error: 'One or more positions already belong to another place' }
      }
    }

    logger.error('Error updating place', { error: errorMessage, updatedBy: userAddress })
    return {
      status: 500,
      body: { ok: false, error: 'Internal server error' }
    }
  }
}
