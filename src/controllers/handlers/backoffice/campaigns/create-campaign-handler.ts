import { DecentralandSignatureContext } from '@dcl/platform-crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { isAllowedUser } from '../../../../logic/allowed-users'
import {
  validateToken,
  validateMode,
  validateTarget,
  validateOptionalText,
  validatePlaceIds,
  parseTimestamp,
  validateWindow,
  CampaignMode,
  TITLE_MAX_LENGTH,
  CTA_MAX_LENGTH
} from '../../../../logic/campaigns'
import { CreateCampaignInput } from '../../../../adapters/campaigns-db'

const PG_UNIQUE_VIOLATION = '23505'

type CreateBody = {
  token?: unknown
  mode?: unknown
  targetType?: unknown
  targetPosition?: unknown
  targetWorld?: unknown
  title?: unknown
  cta?: unknown
  placeIds?: unknown
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

    let mode: CampaignMode = 'ftue'
    if (body.mode !== undefined) {
      const modeError = validateMode(body.mode)
      if (modeError) {
        return { status: 400, body: { ok: false, error: modeError } }
      }
      mode = body.mode as CampaignMode
    }

    const target = validateTarget(body)
    if ('error' in target) {
      return { status: 400, body: { ok: false, error: target.error } }
    }

    const titleError = validateOptionalText(body.title ?? null, 'title', TITLE_MAX_LENGTH)
    if (titleError) {
      return { status: 400, body: { ok: false, error: titleError } }
    }
    const ctaError = validateOptionalText(body.cta ?? null, 'cta', CTA_MAX_LENGTH)
    if (ctaError) {
      return { status: 400, body: { ok: false, error: ctaError } }
    }

    let placeIds: string[] = []
    if (body.placeIds !== undefined && body.placeIds !== null) {
      const placeIdsError = validatePlaceIds(body.placeIds)
      if (placeIdsError) {
        return { status: 400, body: { ok: false, error: placeIdsError } }
      }
      placeIds = body.placeIds as string[]
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
      mode,
      targetType: target.targetType,
      targetPosition: target.targetPosition,
      targetWorld: target.targetWorld,
      title: typeof body.title === 'string' && body.title.trim().length > 0 ? body.title.trim() : null,
      cta: typeof body.cta === 'string' && body.cta.trim().length > 0 ? body.cta.trim() : null,
      placeIds,
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
