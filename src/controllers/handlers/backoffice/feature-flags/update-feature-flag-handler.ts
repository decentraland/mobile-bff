import { DecentralandSignatureContext } from '@dcl/platform-crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { isAllowedUser } from '../../../../logic/allowed-users'
import { validateFlagDescription } from '../../../../logic/feature-flags'
import { UpdateFeatureFlagInput } from '../../../../adapters/feature-flags-db'

type UpdateBody = {
  enabled?: unknown
  description?: unknown
}

export async function updateFeatureFlagHandler(
  context: HandlerContextWithPath<'featureFlagsDb' | 'logs' | 'config', '/backoffice/feature-flags/:name'>
    & DecentralandSignatureContext<any>
) {
  const {
    components: { featureFlagsDb, logs, config },
    verification,
    params,
    request
  } = context

  const logger = logs.getLogger('update-feature-flag')
  const userAddress = verification?.auth
  const name = params.name

  if (!userAddress) {
    return { status: 401, body: { ok: false, error: 'Unauthorized' } }
  }

  if (!(await isAllowedUser(config, userAddress))) {
    return { status: 403, body: { ok: false, error: 'Forbidden: User not in allowed list' } }
  }

  try {
    const body = await request.json() as UpdateBody

    if (body.enabled === undefined && body.description === undefined) {
      return { status: 400, body: { ok: false, error: "At least one of 'enabled' or 'description' is required" } }
    }

    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
      return { status: 400, body: { ok: false, error: "'enabled' must be a boolean" } }
    }

    if (body.description !== undefined) {
      const descriptionError = validateFlagDescription(body.description)
      if (descriptionError) {
        return { status: 400, body: { ok: false, error: descriptionError } }
      }
    }

    const changes: UpdateFeatureFlagInput = {
      ...(body.enabled !== undefined ? { enabled: body.enabled as boolean } : {}),
      ...(body.description !== undefined ? { description: body.description as string | null } : {})
    }

    const flag = await featureFlagsDb.update(name, changes, userAddress)
    if (!flag) {
      return { status: 404, body: { ok: false, error: `Feature flag '${name}' not found` } }
    }

    logger.info('Feature flag updated', { name, updatedBy: userAddress, changes: JSON.stringify(changes) })

    return { status: 200, body: { ok: true, data: flag } }
  } catch (error) {
    logger.error('Error updating feature flag', {
      error: (error as Error).message,
      name,
      updatedBy: userAddress
    })
    return { status: 500, body: { ok: false, error: 'Internal server error' } }
  }
}
