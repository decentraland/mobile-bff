import { DecentralandSignatureContext } from '@dcl/crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { requireBackofficeUser, notFound } from './shared'

export async function getPushStatsHandler(
  context: HandlerContextWithPath<'pushDb' | 'config', '/backoffice/push/campaigns/:id/stats'> &
    DecentralandSignatureContext<any>
) {
  const {
    components: { pushDb, config },
    verification,
    params
  } = context

  const auth = await requireBackofficeUser(config, verification)
  if ('response' in auth) {
    return auth.response
  }

  const campaign = await pushDb.getCampaign(params.id)
  if (!campaign) {
    return notFound(params.id)
  }

  // What the send log knows, and nothing more. Opens and CTR come from the `Push Opened`
  // Segment event and are read in Metabase: a device that was handed a notification and
  // never showed it counts as sent here, and there is no way to tell from this side.
  return { status: 200, body: { ok: true, data: { campaign, stats: await pushDb.getStats(params.id) } } }
}
