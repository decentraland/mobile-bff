import { IBaseComponent } from '@well-known-components/interfaces'
import { AppComponents } from '../types'
import { ClaimedDelivery, DeliveryOutcome } from './push-db'

// Drains the push_deliveries queue.
//
// This is the first background job in the service — everything else here is request/response.
// It is deliberately a poller over the existing table rather than a queue product: the rows
// have to exist anyway (they are the send log the backoffice reports from), and SKIP LOCKED
// already makes claiming safe across replicas, so Redis or SQS would add an operational
// dependency to solve a problem the database is solving.
//
// rate-limiter.ts notes that nobody knows how many replicas run in production. This assumes
// more than one, which is the only assumption that is safe to be wrong about in this
// direction: with a single replica the extra care is harmless, with several the alternative
// sends duplicates.

export type TickResult = {
  reclaimed: number
  claimed: number
  sent: number
  failed: number
  retrying: number
  finishedCampaigns: number
}

export type IPushDispatcherComponent = IBaseComponent & {
  /** Runs exactly one pass. Exposed so tests can drive it without waiting on the timer. */
  tick(): Promise<TickResult>
}

// How long a claimed delivery may sit unresolved before another replica may take it. Has to
// comfortably exceed one batch's worth of sends, or a slow batch gets stolen from under a
// replica that is still working through it.
const LEASE_SECONDS = 300
// Attempts before a delivery is written off. Retries only happen for transport-level and 5xx
// failures, so three is generous; past that the token is not coming back within the TTL.
const MAX_ATTEMPTS = 3

/**
 * Append the attribution params the client reads back as `Push Opened`.
 *
 * Done here rather than stored on the campaign because `push_id` identifies one delivery,
 * not one campaign — it only exists once we know who we are sending to. It also means the
 * backoffice stores the plain destination a person actually typed, and nobody has to
 * hand-write tracking params into a deep link.
 *
 * `push_campaign_id` deliberately is not the ads `c=` token: that one is captured sticky by
 * the client as the install's attribution, so routing a push through it would burn a user's
 * install attribution on a re-engagement tap.
 */
export function withAttribution(deepLink: string, campaignKey: string, pushId: string): string {
  const separator = deepLink.includes('?') ? '&' : '?'
  const params = new URLSearchParams({
    push_campaign_id: campaignKey,
    push_id: pushId,
    source: 'push'
  })
  return `${deepLink}${separator}${params.toString()}`
}

/** Runs `worker` over `items` with at most `limit` in flight. */
async function pooled<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++
      if (index >= items.length) {
        return
      }
      results[index] = await worker(items[index])
    }
  })
  await Promise.all(runners)
  return results
}

export async function createPushDispatcherComponent({
  config,
  logs,
  pushDb,
  fcm
}: Pick<AppComponents, 'config' | 'logs' | 'pushDb' | 'fcm'>): Promise<IPushDispatcherComponent> {
  const logger = logs.getLogger('push-dispatcher')
  const intervalMs = (await config.getNumber('PUSH_DISPATCH_INTERVAL_MS')) ?? 5000
  const batchSize = (await config.getNumber('PUSH_DISPATCH_BATCH_SIZE')) ?? 200
  const concurrency = (await config.getNumber('PUSH_DISPATCH_CONCURRENCY')) ?? 25

  let timer: NodeJS.Timeout | undefined
  // Ticks must not overlap: a slow FCM would otherwise stack batches until the pool is
  // meaningless and the process runs out of sockets.
  let running = false

  async function tick(): Promise<TickResult> {
    const result: TickResult = {
      reclaimed: 0,
      claimed: 0,
      sent: 0,
      failed: 0,
      retrying: 0,
      finishedCampaigns: 0
    }

    result.reclaimed = await pushDb.reclaimStaleDeliveries(LEASE_SECONDS, MAX_ATTEMPTS)

    const deliveries = await pushDb.claimDeliveries(batchSize)
    result.claimed = deliveries.length

    if (deliveries.length > 0) {
      const outcomes: DeliveryOutcome[] = []
      const deadTokens: { token: string; errorCode: string }[] = []

      const sendResults = await pooled(deliveries, concurrency, (delivery) => sendOne(delivery))

      for (let i = 0; i < deliveries.length; i++) {
        const delivery = deliveries[i]
        const outcome = sendResults[i]
        outcomes.push(outcome.outcome)
        if (outcome.deadToken) {
          deadTokens.push({ token: delivery.token, errorCode: outcome.deadToken })
        }
        if (outcome.outcome.state === 'sent') result.sent++
        else if (outcome.outcome.state === 'pending') result.retrying++
        else result.failed++
      }

      // Dead tokens are recorded before the outcomes so a crash in between leaves the
      // delivery retryable rather than leaving a token we know is dead unmarked.
      await pushDb.markTokensDead(deadTokens)
      await pushDb.recordOutcomes(outcomes)
    }

    const finished = await pushDb.finishDrainedCampaigns()
    result.finishedCampaigns = finished.length

    if (result.claimed > 0 || result.reclaimed > 0 || finished.length > 0) {
      logger.info('Dispatch tick', {
        reclaimed: result.reclaimed,
        claimed: result.claimed,
        sent: result.sent,
        failed: result.failed,
        retrying: result.retrying,
        finishedCampaigns: result.finishedCampaigns
      })
    }

    return result
  }

  async function sendOne(
    delivery: ClaimedDelivery
  ): Promise<{ outcome: DeliveryOutcome; deadToken?: string }> {
    // push_id is (campaign, user), not random: FCM can deliver the same message more than
    // once, and the client de-duplicates on this value. A fresh uuid per attempt would
    // defeat that and show the user the notification twice.
    const pushId = `push_${delivery.campaignId}_${delivery.userId}`
    const result = await fcm.send({
      token: delivery.token,
      pushId,
      campaignKey: delivery.campaignKey,
      title: delivery.title,
      body: delivery.body,
      deepLink: withAttribution(delivery.deepLink, delivery.campaignKey, pushId),
      imageUrl: delivery.imageUrl,
      category: delivery.category,
      ttlSeconds: delivery.ttlSeconds
    })

    if (result.status === 'sent') {
      return {
        outcome: {
          campaignId: delivery.campaignId,
          userId: delivery.userId,
          state: 'sent',
          providerMsgId: result.providerMsgId
        }
      }
    }

    // `attempts` is what was already spent before this one, so the +1 is the attempt just
    // made. Out of budget means stop: a delivery that keeps failing is not going to start
    // working inside the message's TTL, and retrying it starves the rest of the campaign.
    const spent = delivery.attempts + 1
    const shouldRetry = result.retryable && spent < MAX_ATTEMPTS

    return {
      outcome: {
        campaignId: delivery.campaignId,
        userId: delivery.userId,
        state: shouldRetry ? 'pending' : 'failed',
        errorCode: result.errorCode
      },
      deadToken: result.tokenIsDead ? result.errorCode : undefined
    }
  }

  async function start() {
    if (timer) {
      return
    }
    logger.info('Starting push dispatcher', {
      intervalMs,
      batchSize,
      concurrency
    })
    timer = setInterval(async () => {
      if (running) {
        return
      }
      running = true
      try {
        await tick()
      } catch (error) {
        // A failed tick must not kill the timer: the queue is durable, so the next pass
        // picks up exactly where this one stopped.
        logger.error('Dispatch tick failed', { error: (error as Error).message })
      } finally {
        running = false
      }
    }, intervalMs)
    // Without unref() this timer alone keeps the process alive, which turns every shutdown
    // into a hang and every test run into a leaked handle.
    timer.unref()
  }

  async function stop() {
    if (timer) {
      clearInterval(timer)
      timer = undefined
    }
  }

  return { start, stop, tick }
}
