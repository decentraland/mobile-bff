import { DecentralandSignatureContext } from '@dcl/platform-crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { isAllowedUser } from '../../../../logic/allowed-users'

export async function getBansHandler(
  context: HandlerContextWithPath<'bansDb' | 'logs' | 'config', '/backoffice/bans'> & DecentralandSignatureContext<any>
) {
  const {
    components: { bansDb, logs, config },
    verification
  } = context

  const logger = logs.getLogger('get-bans')
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
    const bans = await bansDb.getAllBans()

    return {
      status: 200,
      body: {
        ok: true,
        data: bans
      }
    }
  } catch (error) {
    logger.error('Error fetching bans', { error: (error as Error).message })
    return {
      status: 500,
      body: { ok: false, error: 'Internal server error' }
    }
  }
}
