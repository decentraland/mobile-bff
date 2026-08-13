import { DecentralandSignatureContext } from '@dcl/crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { isAllowedUser } from '../../../../logic/allowed-users'
import { Ban } from '../../../../adapters/bans-db'

type CreateBanBody = {
  groupId?: string
  positions?: string[]  // ["x,y", "x,y"] format for scene bans
  worldName?: string
  sceneId?: string  // Entity ID of the scene/world at ban time (for detecting redeploys)
  reason?: string
}

export async function createBanHandler(
  context: HandlerContextWithPath<'bansDb' | 'logs' | 'config', '/backoffice/bans'> & DecentralandSignatureContext<any>
) {
  const {
    components: { bansDb, logs, config },
    verification,
    request
  } = context

  const logger = logs.getLogger('create-ban')
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
    const body = await request.json() as CreateBanBody

    // Must have exactly one of: groupId, positions, or worldName
    const hasGroupId = body.groupId !== undefined && body.groupId !== null
    const hasPositions = body.positions !== undefined && Array.isArray(body.positions) && body.positions.length > 0
    const hasWorldName = body.worldName !== undefined && body.worldName !== null && body.worldName.trim() !== ''

    const optionCount = [hasGroupId, hasPositions, hasWorldName].filter(Boolean).length

    if (optionCount === 0) {
      return {
        status: 400,
        body: { ok: false, error: 'Must specify one of: groupId (group ban), positions (scene ban), or worldName (world ban)' }
      }
    }

    if (optionCount > 1) {
      return {
        status: 400,
        body: { ok: false, error: 'Cannot specify multiple ban types. Use only one of: groupId, positions, or worldName.' }
      }
    }

    let ban: Ban

    if (hasGroupId) {
      // Group ban
      ban = await bansDb.createGroupBan({ groupId: body.groupId!, reason: body.reason }, userAddress)
      logger.info('Group ban created', { id: ban.id, groupId: body.groupId!, createdBy: userAddress })
    } else if (hasWorldName) {
      // World ban
      ban = await bansDb.createWorldBan({
        worldName: body.worldName!.trim(),
        sceneId: body.sceneId,
        reason: body.reason
      }, userAddress)
      logger.info('World ban created', { id: ban.id, worldName: body.worldName!, sceneId: body.sceneId || '', createdBy: userAddress })
    } else {
      // Scene ban - validate positions format (should be "x,y" strings)
      for (const position of body.positions!) {
        if (typeof position !== 'string' || !position.match(/^-?\d+,-?\d+$/)) {
          return {
            status: 400,
            body: { ok: false, error: 'Invalid positions format. Expected array of "x,y" strings' }
          }
        }
      }

      ban = await bansDb.createSceneBan({
        positions: body.positions!,
        sceneId: body.sceneId,
        reason: body.reason
      }, userAddress)
      logger.info('Scene ban created', { id: ban.id, positionCount: body.positions!.length, sceneId: body.sceneId || '', createdBy: userAddress })
    }

    return {
      status: 201,
      body: {
        ok: true,
        data: ban
      }
    }
  } catch (error) {
    const errorMessage = (error as Error).message

    // Check for unique constraint violation (already banned)
    if (errorMessage.includes('duplicate key') || errorMessage.includes('unique constraint')) {
      return {
        status: 409,
        body: { ok: false, error: 'This target is already banned' }
      }
    }

    // Check for FK violation (group doesn't exist)
    if (errorMessage.includes('foreign key') || errorMessage.includes('violates foreign key')) {
      return {
        status: 404,
        body: { ok: false, error: 'Group not found' }
      }
    }

    logger.error('Error creating ban', { error: errorMessage, createdBy: userAddress })
    return {
      status: 500,
      body: { ok: false, error: 'Internal server error' }
    }
  }
}
