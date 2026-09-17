import { DecentralandSignatureContext } from '@dcl/crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { validateCampaignKey, validateCampaignContent, contentWarnings } from '../../../../logic/push'
import { requireBackofficeUser } from './shared'

const PG_UNIQUE_VIOLATION = '23505'

export async function createPushCampaignHandler(
  context: HandlerContextWithPath<'pushDb' | 'logs' | 'config', '/backoffice/push/campaigns'> &
    DecentralandSignatureContext<any>
) {
  const {
    components: { pushDb, logs, config },
    verification,
    request
  } = context

  const logger = logs.getLogger('create-push-campaign')
  const auth = await requireBackofficeUser(config, verification)
  if ('response' in auth) {
    return auth.response
  }

  let campaignKey = ''
  try {
    const body = await request.json()

    const keyError = validateCampaignKey(body.campaignKey)
    if (keyError) {
      return { status: 400, body: { ok: false, error: keyError } }
    }
    campaignKey = body.campaignKey as string

    const validated = validateCampaignContent(body)
    if ('error' in validated) {
      return { status: 400, body: { ok: false, error: validated.error } }
    }

    const campaign = await pushDb.createCampaign({
      campaignKey,
      ...validated.content,
      createdBy: auth.address
    })

    logger.info('Push campaign created', { campaignKey, createdBy: auth.address })

    // Warnings ride along with a 201: copy that will be visually truncated is still a
    // campaign somebody meant to create, and failing it would be worse than saying so.
    return {
      status: 201,
      body: { ok: true, data: campaign, warnings: contentWarnings(validated.content) }
    }
  } catch (error) {
    if ((error as { code?: string }).code === PG_UNIQUE_VIOLATION) {
      return { status: 409, body: { ok: false, error: `Push campaign '${campaignKey}' already exists` } }
    }
    logger.error('Error creating push campaign', {
      error: (error as Error).message,
      createdBy: auth.address
    })
    return { status: 500, body: { ok: false, error: 'Internal server error' } }
  }
}
