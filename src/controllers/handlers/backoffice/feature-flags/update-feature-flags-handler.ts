import { DecentralandSignatureContext } from '@dcl/platform-crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { isAllowedUser } from '../../../../logic/allowed-users'
import { FeatureFlagsMap } from '../../../../adapters/feature-flags-db'

type UpdateBody = {
  flags?: unknown
}

function parseFlags(input: unknown): FeatureFlagsMap | string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return "'flags' must be a non-empty object"
  }

  const entries = Object.entries(input as Record<string, unknown>)
  if (entries.length === 0) {
    return "'flags' must be a non-empty object"
  }

  // Null prototype so keys like '__proto__' are stored as own properties instead of
  // silently hitting Object.prototype setters
  const changes: FeatureFlagsMap = Object.create(null)
  for (const [name, value] of entries) {
    if (typeof value !== 'boolean') {
      return `Flag '${name}' must be a boolean`
    }
    changes[name] = value
  }
  return changes
}

export async function updateFeatureFlagsHandler(
  context: HandlerContextWithPath<'featureFlagsDb' | 'logs' | 'config', '/backoffice/feature-flags'>
    & DecentralandSignatureContext<any>
) {
  const {
    components: { featureFlagsDb, logs, config },
    verification,
    request
  } = context

  const logger = logs.getLogger('update-feature-flags')
  const userAddress = verification?.auth

  if (!userAddress) {
    return { status: 401, body: { ok: false, error: 'Unauthorized' } }
  }

  if (!(await isAllowedUser(config, userAddress))) {
    return { status: 403, body: { ok: false, error: 'Forbidden: User not in allowed list' } }
  }

  try {
    const body = await request.json() as UpdateBody

    const changes = parseFlags(body.flags)
    if (typeof changes === 'string') {
      return { status: 400, body: { ok: false, error: changes } }
    }

    // New flags are introduced only via migration; reject unknown names so typos don't mint flags.
    // hasOwnProperty (not `in`) so inherited keys like 'toString' don't pass as known flags
    const existing = await featureFlagsDb.getAll()
    for (const name of Object.keys(changes)) {
      if (!Object.prototype.hasOwnProperty.call(existing, name)) {
        return { status: 400, body: { ok: false, error: `Unknown feature flag: '${name}'` } }
      }
    }

    const flags = await featureFlagsDb.update(changes, userAddress)

    logger.info('Feature flags updated', { updatedBy: userAddress, changes: JSON.stringify(changes) })

    return { status: 200, body: { ok: true, data: { flags } } }
  } catch (error) {
    logger.error('Error updating feature flags', {
      error: (error as Error).message,
      updatedBy: userAddress
    })
    return { status: 500, body: { ok: false, error: 'Internal server error' } }
  }
}
