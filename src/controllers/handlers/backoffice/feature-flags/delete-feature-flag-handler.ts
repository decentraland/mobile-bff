import { DecentralandSignatureContext } from '@dcl/platform-crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { isAllowedUser } from '../../../../logic/allowed-users'

export async function deleteFeatureFlagHandler(
  context: HandlerContextWithPath<'featureFlagsDb' | 'logs' | 'config', '/backoffice/feature-flags/:name'>
    & DecentralandSignatureContext<any>
) {
  const {
    components: { featureFlagsDb, logs, config },
    verification,
    params
  } = context

  const logger = logs.getLogger('delete-feature-flag')
  const userAddress = verification?.auth
  const name = params.name

  if (!userAddress) {
    return { status: 401, body: { ok: false, error: 'Unauthorized' } }
  }

  if (!(await isAllowedUser(config, userAddress))) {
    return { status: 403, body: { ok: false, error: 'Forbidden: User not in allowed list' } }
  }

  try {
    const deleted = await featureFlagsDb.delete(name)
    if (!deleted) {
      return { status: 404, body: { ok: false, error: `Feature flag '${name}' not found` } }
    }

    logger.info('Feature flag deleted', { name, deletedBy: userAddress })

    return { status: 200, body: { ok: true, data: { name } } }
  } catch (error) {
    logger.error('Error deleting feature flag', {
      error: (error as Error).message,
      name,
      deletedBy: userAddress
    })
    return { status: 500, body: { ok: false, error: 'Internal server error' } }
  }
}
