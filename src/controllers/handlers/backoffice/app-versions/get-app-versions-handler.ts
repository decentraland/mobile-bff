import { DecentralandSignatureContext } from '@dcl/crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { isAllowedUser } from '../../../../logic/allowed-users'

// Lists every track at once so the backoffice can render a track picker without knowing
// which tracks exist.
export async function getBackofficeAppVersionsHandler(
  context: HandlerContextWithPath<'appVersionsDb' | 'logs' | 'config', '/backoffice/app-versions'>
    & DecentralandSignatureContext<any>
) {
  const {
    components: { appVersionsDb, logs, config },
    verification
  } = context

  const logger = logs.getLogger('get-backoffice-app-versions')
  const userAddress = verification?.auth

  if (!userAddress) {
    return { status: 401, body: { ok: false, error: 'Unauthorized' } }
  }

  if (!(await isAllowedUser(config, userAddress))) {
    return { status: 403, body: { ok: false, error: 'Forbidden: User not in allowed list' } }
  }

  try {
    const tracks = await appVersionsDb.getAll()
    return { status: 200, body: { ok: true, data: { tracks } } }
  } catch (error) {
    logger.error('Error fetching app versions', { error: (error as Error).message })
    return { status: 500, body: { ok: false, error: 'Internal server error' } }
  }
}
