import { DecentralandSignatureContext } from '@dcl/crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { requireBackofficeUser, notFound } from './shared'

export async function approvePushCampaignHandler(
  context: HandlerContextWithPath<'pushDb' | 'logs' | 'config', '/backoffice/push/campaigns/:id/approve'> &
    DecentralandSignatureContext<any>
) {
  const {
    components: { pushDb, logs, config },
    verification,
    params
  } = context

  const logger = logs.getLogger('approve-push-campaign')
  const auth = await requireBackofficeUser(config, verification)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const approved = await pushDb.approveCampaign(params.id, auth.address)
    if (approved) {
      logger.info('Push campaign approved', {
        id: params.id,
        campaignKey: approved.campaignKey,
        audienceCount: approved.audienceCount,
        createdBy: approved.createdBy,
        approvedBy: auth.address
      })
      return { status: 200, body: { ok: true, data: approved } }
    }

    // approveCampaign refuses on three different grounds; a bare "cannot approve" would
    // leave the operator guessing which one, and the self-approval case in particular
    // needs to read as a rule and not a bug.
    const campaign = await pushDb.getCampaign(params.id)
    if (!campaign) {
      return notFound(params.id)
    }
    if (campaign.createdBy === auth.address) {
      return {
        status: 403,
        body: { ok: false, error: 'A campaign must be approved by someone other than its creator' }
      }
    }
    return {
      status: 409,
      body: { ok: false, error: `Only a campaign pending approval can be approved; this one is '${campaign.status}'` }
    }
  } catch (error) {
    logger.error('Error approving push campaign', { error: (error as Error).message, id: params.id })
    return { status: 500, body: { ok: false, error: 'Internal server error' } }
  }
}
