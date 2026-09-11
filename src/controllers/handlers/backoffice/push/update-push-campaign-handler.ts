import { DecentralandSignatureContext } from '@dcl/crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { validateCampaignContent, contentWarnings } from '../../../../logic/push'
import { requireBackofficeUser, notFound } from './shared'

export async function updatePushCampaignHandler(
  context: HandlerContextWithPath<'pushDb' | 'logs' | 'config', '/backoffice/push/campaigns/:id'> &
    DecentralandSignatureContext<any>
) {
  const {
    components: { pushDb, logs, config },
    verification,
    params,
    request
  } = context

  const logger = logs.getLogger('update-push-campaign')
  const auth = await requireBackofficeUser(config, verification)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const validated = validateCampaignContent(await request.json())
    if ('error' in validated) {
      return { status: 400, body: { ok: false, error: validated.error } }
    }

    const updated = await pushDb.updateCampaign(params.id, validated.content)
    if (!updated) {
      // updateCampaign only matches drafts, so a miss is either a bad id or a campaign that
      // has already been submitted. Telling them apart makes the difference between "typo"
      // and "someone is already reviewing this".
      const existing = await pushDb.getCampaign(params.id)
      if (!existing) {
        return notFound(params.id)
      }
      return {
        status: 409,
        body: { ok: false, error: `Only a draft can be edited; this campaign is '${existing.status}'` }
      }
    }

    logger.info('Push campaign updated', { id: params.id, updatedBy: auth.address })
    return { status: 200, body: { ok: true, data: updated, warnings: contentWarnings(validated.content) } }
  } catch (error) {
    logger.error('Error updating push campaign', { error: (error as Error).message, id: params.id })
    return { status: 500, body: { ok: false, error: 'Internal server error' } }
  }
}
