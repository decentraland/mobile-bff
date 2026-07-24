import { DecentralandSignatureContext } from '@dcl/platform-crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { isAllowedUser } from '../../../../logic/allowed-users'
import { validateFlagName, validateFlagDescription } from '../../../../logic/feature-flags'

type CreateBody = {
  name?: unknown
  enabled?: unknown
  description?: unknown
}

const PG_UNIQUE_VIOLATION = '23505'

export async function createFeatureFlagHandler(
  context: HandlerContextWithPath<'featureFlagsDb' | 'logs' | 'config', '/backoffice/feature-flags'>
    & DecentralandSignatureContext<any>
) {
  const {
    components: { featureFlagsDb, logs, config },
    verification,
    request
  } = context

  const logger = logs.getLogger('create-feature-flag')
  const userAddress = verification?.auth

  if (!userAddress) {
    return { status: 401, body: { ok: false, error: 'Unauthorized' } }
  }

  if (!(await isAllowedUser(config, userAddress))) {
    return { status: 403, body: { ok: false, error: 'Forbidden: User not in allowed list' } }
  }

  let name = ''
  try {
    const body = await request.json() as CreateBody

    const nameError = validateFlagName(body.name)
    if (nameError) {
      return { status: 400, body: { ok: false, error: nameError } }
    }
    name = body.name as string

    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
      return { status: 400, body: { ok: false, error: "'enabled' must be a boolean" } }
    }

    if (body.description !== undefined) {
      const descriptionError = validateFlagDescription(body.description)
      if (descriptionError) {
        return { status: 400, body: { ok: false, error: descriptionError } }
      }
    }

    const description = typeof body.description === 'string' && body.description.trim().length > 0
      ? body.description.trim()
      : null

    const flag = await featureFlagsDb.create(
      { name, enabled: body.enabled === true, description },
      userAddress
    )

    logger.info('Feature flag created', { name, createdBy: userAddress })

    return { status: 201, body: { ok: true, data: flag } }
  } catch (error) {
    if ((error as { code?: string }).code === PG_UNIQUE_VIOLATION) {
      return { status: 409, body: { ok: false, error: `Feature flag '${name}' already exists` } }
    }
    logger.error('Error creating feature flag', {
      error: (error as Error).message,
      createdBy: userAddress
    })
    return { status: 500, body: { ok: false, error: 'Internal server error' } }
  }
}
