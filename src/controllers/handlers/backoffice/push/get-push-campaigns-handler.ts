import { DecentralandSignatureContext } from '@dcl/crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { requireBackofficeUser } from './shared'

export async function getPushCampaignsHandler(
  context: HandlerContextWithPath<'pushDb' | 'config', '/backoffice/push/campaigns'> &
    DecentralandSignatureContext<any>
) {
  const {
    components: { pushDb, config },
    verification
  } = context

  const auth = await requireBackofficeUser(config, verification)
  if ('response' in auth) {
    return auth.response
  }

  return { status: 200, body: { ok: true, data: await pushDb.listCampaigns() } }
}
