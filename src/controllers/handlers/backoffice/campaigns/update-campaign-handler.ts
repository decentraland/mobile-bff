import { DecentralandSignatureContext } from '@dcl/platform-crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { isAllowedUser } from '../../../../logic/allowed-users'
import {
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
import { UpdateCampaignInput } from '../../../../adapters/campaigns-db'

type UpdateBody = {
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

const TARGET_FIELDS = ['targetType', 'targetPosition', 'targetWorld'] as const

export async function updateCampaignHandler(
  context: HandlerContextWithPath<'campaignsDb' | 'logs' | 'config', '/backoffice/campaigns/:token'>
    & DecentralandSignatureContext<any>
) {
  const {
    components: { campaignsDb, logs, config },
    verification,
    request,
    params
  } = context

  const logger = logs.getLogger('update-campaign')
  const userAddress = verification?.auth
  const token = params.token

  if (!userAddress) {
    return { status: 401, body: { ok: false, error: 'Unauthorized' } }
  }

  if (!(await isAllowedUser(config, userAddress))) {
    return { status: 403, body: { ok: false, error: 'Forbidden: User not in allowed list' } }
  }

  try {
    const body = await request.json() as UpdateBody
    const changes: UpdateCampaignInput = {}

    if (body.mode !== undefined) {
      const modeError = validateMode(body.mode)
      if (modeError) {
        return { status: 400, body: { ok: false, error: modeError } }
      }
      changes.mode = body.mode as CampaignMode
    }

    // The target columns are constrained as a unit (exactly one populated, matching
    // targetType), so a partial target edit cannot be validated in isolation — ask for
    // the whole target rather than merging it with the stored row and guessing.
    if (TARGET_FIELDS.some(field => body[field] !== undefined)) {
      const target = validateTarget(body)
      if ('error' in target) {
        return { status: 400, body: { ok: false, error: target.error } }
      }
      changes.targetType = target.targetType
      changes.targetPosition = target.targetPosition
      changes.targetWorld = target.targetWorld
    }

    if (body.title !== undefined) {
      const titleError = validateOptionalText(body.title, 'title', TITLE_MAX_LENGTH)
      if (titleError) {
        return { status: 400, body: { ok: false, error: titleError } }
      }
      changes.title = typeof body.title === 'string' && body.title.trim().length > 0
        ? body.title.trim()
        : null
    }

    if (body.cta !== undefined) {
      const ctaError = validateOptionalText(body.cta, 'cta', CTA_MAX_LENGTH)
      if (ctaError) {
        return { status: 400, body: { ok: false, error: ctaError } }
      }
      changes.cta = typeof body.cta === 'string' && body.cta.trim().length > 0
        ? body.cta.trim()
        : null
    }

    if (body.placeIds !== undefined) {
      const placeIdsError = validatePlaceIds(body.placeIds ?? [])
      if (placeIdsError) {
        return { status: 400, body: { ok: false, error: placeIdsError } }
      }
      changes.placeIds = body.placeIds as string[]
    }

    if (body.startsAt !== undefined) {
      const startsAt = parseTimestamp(body.startsAt, 'startsAt')
      if ('error' in startsAt) {
        return { status: 400, body: { ok: false, error: startsAt.error } }
      }
      changes.startsAt = startsAt.value
    }

    if (body.endsAt !== undefined) {
      const endsAt = parseTimestamp(body.endsAt, 'endsAt')
      if ('error' in endsAt) {
        return { status: 400, body: { ok: false, error: endsAt.error } }
      }
      changes.endsAt = endsAt.value
    }

    if (body.enabled !== undefined) {
      if (typeof body.enabled !== 'boolean') {
        return { status: 400, body: { ok: false, error: "'enabled' must be a boolean" } }
      }
      changes.enabled = body.enabled
    }

    if (Object.keys(changes).length === 0) {
      return { status: 400, body: { ok: false, error: 'No valid fields to update' } }
    }

    const existing = await campaignsDb.getByToken(token)
    if (!existing) {
      return { status: 404, body: { ok: false, error: `Campaign '${token}' not found` } }
    }

    // Only one end of the window may be edited at a time, so check the effective
    // window (the merge of the change with what is already stored).
    const effectiveStartsAt = changes.startsAt !== undefined
      ? changes.startsAt
      : existing.startsAt ? new Date(existing.startsAt) : null
    const effectiveEndsAt = changes.endsAt !== undefined
      ? changes.endsAt
      : existing.endsAt ? new Date(existing.endsAt) : null
    const windowError = validateWindow(effectiveStartsAt, effectiveEndsAt)
    if (windowError) {
      return { status: 400, body: { ok: false, error: windowError } }
    }

    const campaign = await campaignsDb.update(token, changes, userAddress)
    if (!campaign) {
      return { status: 404, body: { ok: false, error: `Campaign '${token}' not found` } }
    }

    logger.info('Campaign updated', { token, updatedBy: userAddress })

    return { status: 200, body: { ok: true, data: campaign } }
  } catch (error) {
    logger.error('Error updating campaign', {
      error: (error as Error).message,
      token,
      updatedBy: userAddress
    })
    return { status: 500, body: { ok: false, error: 'Internal server error' } }
  }
}
