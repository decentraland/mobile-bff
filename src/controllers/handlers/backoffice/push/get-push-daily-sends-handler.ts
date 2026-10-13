import { DecentralandSignatureContext } from '@dcl/crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { requireBackofficeUser } from './shared'

const DEFAULT_DAYS = 30
const MAX_DAYS = 90

/**
 * How many pushes went out, per campaign per UTC day, over the last `days` days.
 *
 * The per-campaign stats answer "how did this campaign do"; this answers "what did we send
 * this week", which for a recurring campaign is the only view that means anything — its
 * totals only ever grow. Days are UTC because `sent_at` is, and because an install's own
 * evening is a different day for each one.
 */
export async function getPushDailySendsHandler(
  context: HandlerContextWithPath<'pushDb' | 'config', '/backoffice/push/stats/daily'> &
    DecentralandSignatureContext<any>
) {
  const {
    components: { pushDb, config },
    verification,
    url
  } = context

  const auth = await requireBackofficeUser(config, verification)
  if ('response' in auth) {
    return auth.response
  }

  const raw = url.searchParams.get('days')
  const days = raw === null ? DEFAULT_DAYS : Number(raw)
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    return { status: 400, body: { ok: false, error: `'days' must be an integer between 1 and ${MAX_DAYS}` } }
  }

  return { status: 200, body: { ok: true, data: { days, rows: await pushDb.dailySends(days) } } }
}
