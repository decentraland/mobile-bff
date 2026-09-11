import { DecentralandSignatureContext } from '@dcl/crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { withAttribution } from '../../../../adapters/push-dispatcher'
import { requireBackofficeUser, notFound } from './shared'

// Small on purpose: this is "check it on my phone", not a second way to run a campaign.
const MAX_TEST_TOKENS = 5

/**
 * Send a campaign to a handful of devices without approving it.
 *
 * Deliberately outside the queue: nothing is written to push_deliveries, so a test cannot
 * move the campaign's counters or be mistaken for part of the real send. It also needs no
 * approval — requiring two people to look at a preview would just mean nobody previews.
 *
 * Recipients come from the request when given, otherwise from PUSH_TEST_TOKENS. The env var
 * is a placeholder for a decision that is still open (who the team test list is); it works
 * today because whoever is testing can paste their own device token.
 */
export async function testSendPushCampaignHandler(
  context: HandlerContextWithPath<'pushDb' | 'fcm' | 'logs' | 'config', '/backoffice/push/campaigns/:id/test'> &
    DecentralandSignatureContext<any>
) {
  const {
    components: { pushDb, fcm, logs, config },
    verification,
    params,
    request
  } = context

  const logger = logs.getLogger('test-send-push')
  const auth = await requireBackofficeUser(config, verification)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const campaign = await pushDb.getCampaign(params.id)
    if (!campaign) {
      return notFound(params.id)
    }

    let tokens: string[] = []
    try {
      const body = await request.json()
      if (Array.isArray(body?.tokens)) {
        tokens = body.tokens.filter((token: unknown): token is string => typeof token === 'string' && !!token)
      }
    } catch {
      // No body is the normal case: fall through to the configured list.
    }
    if (tokens.length === 0) {
      const configured = (await config.getString('PUSH_TEST_TOKENS')) ?? ''
      tokens = configured
        .split(',')
        .map((token) => token.trim())
        .filter(Boolean)
    }

    if (tokens.length === 0) {
      return {
        status: 409,
        body: {
          ok: false,
          error: 'No test recipients: pass { "tokens": [...] } or configure PUSH_TEST_TOKENS'
        }
      }
    }
    if (tokens.length > MAX_TEST_TOKENS) {
      return { status: 400, body: { ok: false, error: `At most ${MAX_TEST_TOKENS} test recipients` } }
    }

    const results = await Promise.all(
      tokens.map(async (token, index) => {
        // A fresh push_id per test send, so re-testing the same campaign on the same device
        // is not swallowed by the client's de-duplication.
        const pushId = `push_test_${campaign.id}_${Date.now()}_${index}`
        const result = await fcm.send({
          token,
          pushId,
          campaignKey: campaign.campaignKey,
          title: campaign.title,
          body: campaign.body,
          deepLink: withAttribution(campaign.deepLink, campaign.campaignKey, pushId),
          imageUrl: campaign.imageUrl,
          category: campaign.category,
          ttlSeconds: campaign.ttlSeconds
        })
        return result.status === 'sent'
          ? { ok: true as const, providerMsgId: result.providerMsgId }
          : { ok: false as const, errorCode: result.errorCode }
      })
    )

    logger.info('Push campaign test send', {
      id: params.id,
      campaignKey: campaign.campaignKey,
      recipients: tokens.length,
      delivered: results.filter((r) => r.ok).length,
      sentBy: auth.address
    })

    return { status: 200, body: { ok: true, data: { results } } }
  } catch (error) {
    logger.error('Error sending test push', { error: (error as Error).message, id: params.id })
    return { status: 500, body: { ok: false, error: 'Internal server error' } }
  }
}
