import { DecentralandSignatureContext } from '@dcl/platform-crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { isAllowedUser } from '../../../../logic/allowed-users'
import { validateFlagName, validateFlagDescription, validateFlagType, normalizeFlagValue, FlagType } from '../../../../logic/feature-flags'

type CreateBody = {
  name?: unknown
  type?: unknown
  enabled?: unknown
  value?: unknown
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

    let type: FlagType = 'on-off'
    if (body.type !== undefined) {
      const typeError = validateFlagType(body.type)
      if (typeError) {
        return { status: 400, body: { ok: false, error: typeError } }
      }
      type = body.type as FlagType
    }

    let value: string | null = null
    if (type === 'on-off') {
      if (body.value !== undefined) {
        return { status: 400, body: { ok: false, error: "'value' is only valid for text and number flags; on-off flags use 'enabled'" } }
      }
      if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
        return { status: 400, body: { ok: false, error: "'enabled' must be a boolean" } }
      }
    } else {
      if (body.enabled !== undefined) {
        return { status: 400, body: { ok: false, error: "'enabled' is only valid for on-off flags; text and number flags use 'value'" } }
      }
      const normalized = normalizeFlagValue(type, body.value)
      if ('error' in normalized) {
        return { status: 400, body: { ok: false, error: normalized.error } }
      }
      value = normalized.value
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
      { name, type, enabled: body.enabled === true, value, description },
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
