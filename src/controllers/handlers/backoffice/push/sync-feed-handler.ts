import { DecentralandSignatureContext } from '@dcl/crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { FeedRefusedError } from '../../../../adapters/push-feed'
import { requireBackofficeUser } from './shared'

/**
 * Read the warehouse audience feed now instead of waiting for the next poll.
 *
 * The background loop is what actually keeps the queues filled; this exists so an operator
 * can see what a sync would do — how many rows the feed holds, which slices it produces that
 * no campaign here serves, how many rows were refused and why. It is also the only way
 * to drive an ingest in an environment where the loop is disabled.
 *
 * No approval gate: an ingest cannot send anything. It only ever adds `pending` rows to a
 * campaign a second person already approved, and the same sync run twice is a no-op.
 */
export async function syncPushFeedHandler(
  context: HandlerContextWithPath<'pushFeed' | 'logs' | 'config', '/backoffice/push/feed/sync'> &
    DecentralandSignatureContext<any>
) {
  const {
    components: { pushFeed, logs, config },
    verification
  } = context

  const logger = logs.getLogger('sync-push-feed')
  const auth = await requireBackofficeUser(config, verification)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const report = await pushFeed.sync()
    logger.info('Push feed synced', {
      requestedBy: auth.address,
      rowsRead: report.rowsRead,
      queued: report.queued
    })
    return { status: 200, body: { ok: true, data: report } }
  } catch (error: any) {
    const message: string = error?.message ?? 'unknown'
    logger.warn('Push feed sync failed', { requestedBy: auth.address, error: message })
    // The warehouse being unreachable is not this service misbehaving, but what it says when
    // it refuses is its own error text — the account, the role, the statement — and that stays
    // in the logs. A refusal this service made is worded for the operator and is shown.
    const shown = error instanceof FeedRefusedError ? message : 'see the service logs for the cause'
    return { status: 502, body: { ok: false, error: `feed sync failed: ${shown}` } }
  }
}
