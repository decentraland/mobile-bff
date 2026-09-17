import { DecentralandSignatureContext } from '@dcl/crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { requireBackofficeUser, notFound } from './shared'

export async function submitPushCampaignHandler(
  context: HandlerContextWithPath<'pushDb' | 'logs' | 'config', '/backoffice/push/campaigns/:id/submit'> &
    DecentralandSignatureContext<any>
) {
  const {
    components: { pushDb, logs, config },
    verification,
    params
  } = context

  const logger = logs.getLogger('submit-push-campaign')
  const auth = await requireBackofficeUser(config, verification)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const campaign = await pushDb.getCampaign(params.id)
    if (!campaign) {
      return notFound(params.id)
    }
    // An approver would otherwise be asked to sign off on a campaign that reaches nobody,
    // and it would sit in `scheduled` forever with an empty queue.
    if (campaign.audienceCount === 0) {
      return { status: 409, body: { ok: false, error: 'Upload an audience before submitting for approval' } }
    }

    const submitted = await pushDb.setStatus(params.id, ['draft'], 'pending_approval')
    if (!submitted) {
      return {
        status: 409,
        body: { ok: false, error: `Only a draft can be submitted; this campaign is '${campaign.status}'` }
      }
    }

    logger.info('Push campaign submitted for approval', { id: params.id, submittedBy: auth.address })
    return { status: 200, body: { ok: true, data: submitted } }
  } catch (error) {
    logger.error('Error submitting push campaign', { error: (error as Error).message, id: params.id })
    return { status: 500, body: { ok: false, error: 'Internal server error' } }
  }
}
