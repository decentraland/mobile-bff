import { DecentralandSignatureContext } from '@dcl/crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { requireBackofficeUser, notFound } from './shared'

export async function cancelPushCampaignHandler(
  context: HandlerContextWithPath<'pushDb' | 'logs' | 'config', '/backoffice/push/campaigns/:id/cancel'> &
    DecentralandSignatureContext<any>
) {
  const {
    components: { pushDb, logs, config },
    verification,
    params
  } = context

  const logger = logs.getLogger('cancel-push-campaign')
  const auth = await requireBackofficeUser(config, verification)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const cancelled = await pushDb.cancelCampaign(params.id)
    if (!cancelled) {
      const campaign = await pushDb.getCampaign(params.id)
      if (!campaign) {
        return notFound(params.id)
      }
      return {
        status: 409,
        body: { ok: false, error: `A campaign that is '${campaign.status}' cannot be cancelled` }
      }
    }

    // The kill switch, so it is logged at a level somebody will find afterwards.
    logger.warn('Push campaign cancelled', {
      id: params.id,
      campaignKey: cancelled.campaign.campaignKey,
      cancelledDeliveries: cancelled.cancelledDeliveries,
      cancelledBy: auth.address
    })

    return {
      status: 200,
      body: {
        ok: true,
        data: {
          campaign: cancelled.campaign,
          // What was still queued. Anything already sent is gone, and saying otherwise
          // would make the report disagree with the devices.
          cancelledDeliveries: cancelled.cancelledDeliveries
        }
      }
    }
  } catch (error) {
    logger.error('Error cancelling push campaign', { error: (error as Error).message, id: params.id })
    return { status: 500, body: { ok: false, error: 'Internal server error' } }
  }
}
