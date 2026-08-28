import { DecentralandSignatureContext } from '@dcl/crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { isAllowedUser } from '../../../../logic/allowed-users'
import { validateTarget } from '../../../../logic/campaigns'

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
    const body = await request.json()

    // The target columns are constrained as a unit (exactly one populated, matching
    // targetType), so the whole target is required rather than a partial edit merged
    // with the stored row.
    const target = validateTarget(body)
    if ('error' in target) {
      return { status: 400, body: { ok: false, error: target.error } }
    }

    const campaign = await campaignsDb.update(token, target)
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
