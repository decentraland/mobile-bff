import { DecentralandSignatureContext } from '@dcl/platform-crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { isAllowedUser } from '../../../../logic/allowed-users'
import {
  validateToken,
  validateTarget,
  parseTimestamp,
  validateWindow
} from '../../../../logic/campaigns'
import { CreateCampaignInput } from '../../../../adapters/campaigns-db'

const PG_UNIQUE_VIOLATION = '23505'

type CreateBody = {
  token?: unknown
  targetType?: unknown
  targetPosition?: unknown
  targetWorld?: unknown
  startsAt?: unknown
  endsAt?: unknown
  enabled?: unknown
}

export async function createCampaignHandler(
  context: HandlerContextWithPath<'campaignsDb' | 'logs' | 'config', '/backoffice/campaigns'>
    & DecentralandSignatureContext<any>
) {
  const {
    components: { campaignsDb, logs, config },
    verification,
    request
  } = context

  const logger = logs.getLogger('create-campaign')
  const userAddress = verification?.auth

  if (!userAddress) {
    return { status: 401, body: { ok: false, error: 'Unauthorized' } }
  }

  if (!(await isAllowedUser(config, userAddress))) {
    return { status: 403, body: { ok: false, error: 'Forbidden: User not in allowed list' } }
  }

  let token = ''
  try {
    const body = await request.json() as CreateBody

    const tokenError = validateToken(body.token)
    if (tokenError) {
      return { status: 400, body: { ok: false, error: tokenError } }
    }
    token = body.token as string

    const target = validateTarget(body)
    if ('error' in target) {
      return { status: 400, body: { ok: false, error: target.error } }
    }

    const startsAt = parseTimestamp(body.startsAt, 'startsAt')
    if ('error' in startsAt) {
      return { status: 400, body: { ok: false, error: startsAt.error } }
    }
    const endsAt = parseTimestamp(body.endsAt, 'endsAt')
    if ('error' in endsAt) {
      return { status: 400, body: { ok: false, error: endsAt.error } }
    }
    const windowError = validateWindow(startsAt.value, endsAt.value)
    if (windowError) {
      return { status: 400, body: { ok: false, error: windowError } }
    }

    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
      return { status: 400, body: { ok: false, error: "'enabled' must be a boolean" } }
    }

    const input: CreateCampaignInput = {
      token,
      targetType: target.targetType,
      targetPosition: target.targetPosition,
      targetWorld: target.targetWorld,
      startsAt: startsAt.value,
      endsAt: endsAt.value,
      enabled: body.enabled === true
    }

    const campaign = await campaignsDb.create(input, userAddress)

    logger.info('Campaign created', { token, createdBy: userAddress })

    return { status: 201, body: { ok: true, data: campaign } }
  } catch (error) {
    if ((error as { code?: string }).code === PG_UNIQUE_VIOLATION) {
      return { status: 409, body: { ok: false, error: `Campaign '${token}' already exists` } }
    }
    logger.error('Error creating campaign', {
      error: (error as Error).message,
      createdBy: userAddress
    })
    return { status: 500, body: { ok: false, error: 'Internal server error' } }
  }
}
