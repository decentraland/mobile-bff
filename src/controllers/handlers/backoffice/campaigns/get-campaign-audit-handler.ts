import { DecentralandSignatureContext } from '@dcl/platform-crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { isAllowedUser } from '../../../../logic/allowed-users'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export async function getCampaignAuditHandler(
  context: HandlerContextWithPath<'campaignsDb' | 'logs' | 'config', '/backoffice/campaigns/:token/audit'>
    & DecentralandSignatureContext<any>
) {
  const {
    components: { campaignsDb, logs, config },
    verification,
    params,
    url
  } = context

  const logger = logs.getLogger('get-campaign-audit')
  const userAddress = verification?.auth
  const token = params.token

  if (!userAddress) {
    return { status: 401, body: { ok: false, error: 'Unauthorized' } }
  }

  if (!(await isAllowedUser(config, userAddress))) {
    return { status: 403, body: { ok: false, error: 'Forbidden: User not in allowed list' } }
  }

  const searchParams = new URL(url.toString()).searchParams
  const rawLimit = Number(searchParams.get('limit'))
  const limit = Number.isInteger(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, MAX_LIMIT)
    : DEFAULT_LIMIT

  try {
    // The trail outlives the campaign, so a deleted token still answers here.
    const entries = await campaignsDb.getAudit(token, limit)
    return { status: 200, body: { ok: true, data: { entries } } }
  } catch (error) {
    logger.error('Error fetching campaign audit', {
      error: (error as Error).message,
      token
    })
    return { status: 500, body: { ok: false, error: 'Internal server error' } }
  }
}
