import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import { createMetricsComponent } from '@well-known-components/metrics'
import { IPgComponent } from '@well-known-components/pg-component'
import { metricDeclarations } from '../../src/metrics'
import { startPgWithMigrations } from '../utils/pg'
import { createPushDbComponent, IPushDbComponent } from '../../src/adapters/push-db'
import { IFcmComponent, PushMessage, SendResult } from '../../src/adapters/fcm'
import { createPushDispatcherComponent, withAttribution } from '../../src/adapters/push-dispatcher'

// These tests require a real PostgreSQL database and are designed to run in CI
// Skip locally if PostgreSQL is not available
const runDbTests = process.env.CI === 'true' || process.env.RUN_DB_TESTS === 'true'

describe('push attribution links', () => {
  // The client reads these back as `Push Opened`; getting the separator wrong silently
  // produces a link that routes but cannot be attributed.
  it('appends tracking params whether or not the link already has a query', () => {
    expect(withAttribution('decentraland://open?position=0,0', 'spring', 'push_1')).toBe(
      'decentraland://open?position=0,0&push_campaign_id=spring&push_id=push_1&source=push'
    )
    expect(withAttribution('decentraland://open', 'spring', 'push_1')).toBe(
      'decentraland://open?push_campaign_id=spring&push_id=push_1&source=push'
    )
  })
})

;(runDbTests ? describe : describe.skip)('push-db integration tests', () => {
  const CREATOR = '0x1111111111111111111111111111111111111111'
  const APPROVER = '0x2222222222222222222222222222222222222222'

  let pg: IPgComponent
  let pushDb: IPushDbComponent
  let sent: PushMessage[]
  let respond: (message: PushMessage) => SendResult

  // Stands in for FCM so the dispatcher's decisions are observable without a network.
  const fcm: IFcmComponent = {
    async send(message: PushMessage): Promise<SendResult> {
      sent.push(message)
      return respond(message)
    }
  }

  async function makeDispatcher() {
    const config = await createDotEnvConfigComponent({ path: ['.env.default', '.env'] })
    const metrics = await createMetricsComponent(metricDeclarations, { config })
    const logs = await createLogComponent({ metrics })
    return createPushDispatcherComponent({ config, logs, pushDb, fcm })
  }

  beforeAll(async () => {
    // Force test database to avoid messing with local dev data
    process.env.PG_COMPONENT_PSQL_DATABASE = 'mobile_test'

    const config = await createDotEnvConfigComponent({ path: ['.env.default', '.env'] })
    const metrics = await createMetricsComponent(metricDeclarations, { config })
    const logs = await createLogComponent({ metrics })

    pg = await startPgWithMigrations({ logs, config, metrics })
    pushDb = await createPushDbComponent({ pg })
  })

  afterAll(async () => {
    if (pg) {
      await pg.stop()
    }
  })

  beforeEach(async () => {
    // push_deliveries goes with the campaigns via ON DELETE CASCADE.
    await pg.query('DELETE FROM push_campaigns')
    await pg.query('DELETE FROM push_dead_tokens')
    sent = []
    respond = () => ({ status: 'sent', providerMsgId: 'projects/test/messages/1' })
  })


  function newCampaign(key: string) {
    return {
      campaignKey: key,
      title: 'Come back',
      body: 'Something is happening in Genesis Plaza',
      deepLink: 'decentraland://open?position=0,0',
      imageUrl: null,
      ttlSeconds: 86400,
      scheduledAt: null,
      createdBy: CREATOR
    }
  }

  // One scenario covering the whole life of a campaign rather than a test per method:
  // the states only mean anything in sequence, and each step's precondition is the
  // previous step's effect.
  it('takes a campaign from draft to sent, and every gate holds on the way', async () => {
    const campaign = await pushDb.createCampaign(newCampaign('spring-event'))
    expect(campaign.status).toBe('draft')
    expect(campaign.ttlSeconds).toBe(86400)

    // A token FCM already rejected must not be paid for again.
    await pushDb.markTokensDead([{ token: 'dead-token', errorCode: 'UNREGISTERED' }])

    const report = await pushDb.replaceAudience(campaign.id, [
      { userId: 'user-a', token: 'token-a' },
      { userId: 'user-b', token: 'token-b' },
      // Same user twice: the second wins, and it counts as a duplicate rather than two sends.
      { userId: 'user-b', token: 'token-b-newer' },
      { userId: 'user-c', token: 'dead-token' }
    ])
    expect(report).toEqual({ received: 4, valid: 2, duplicates: 1, suppressed: 1 })
    expect((await pushDb.getCampaign(campaign.id))?.audienceCount).toBe(2)

    // Nothing is claimable until the campaign is approved.
    expect(await pushDb.claimDeliveries(10)).toHaveLength(0)

    expect(await pushDb.setStatus(campaign.id, ['draft'], 'pending_approval')).not.toBeNull()

    // Two-man rule: the creator cannot approve their own campaign.
    expect(await pushDb.approveCampaign(campaign.id, CREATOR)).toBeNull()
    expect((await pushDb.getCampaign(campaign.id))?.status).toBe('pending_approval')

    const approved = await pushDb.approveCampaign(campaign.id, APPROVER)
    expect(approved?.status).toBe('scheduled')
    expect(approved?.approvedBy).toBe(APPROVER)

    const claimed = await pushDb.claimDeliveries(10)
    expect(claimed).toHaveLength(2)
    expect(claimed[0].campaignKey).toBe('spring-event')
    expect(claimed[0].ttlSeconds).toBe(86400)
    // Claiming flips the campaign so the UI can tell "waiting" from "going out now".
    expect((await pushDb.getCampaign(campaign.id))?.status).toBe('sending')

    const byUser = Object.fromEntries(claimed.map((d) => [d.userId, d]))
    expect(byUser['user-b'].token).toBe('token-b-newer')

    await pushDb.recordOutcomes([
      { campaignId: campaign.id, userId: 'user-a', state: 'sent', providerMsgId: 'projects/x/messages/1' },
      { campaignId: campaign.id, userId: 'user-b', state: 'failed', errorCode: 'UNREGISTERED' }
    ])

    expect(await pushDb.finishDrainedCampaigns()).toEqual([campaign.id])
    const finished = await pushDb.getCampaign(campaign.id)
    expect(finished?.status).toBe('sent')
    expect(finished?.finishedAt).not.toBeNull()

    const stats = await pushDb.getStats(campaign.id)
    expect(stats).toMatchObject({
      attempted: 2,
      sent: 1,
      failed: 1,
      pending: 0,
      inFlight: 0,
      errors: { UNREGISTERED: 1 }
    })
  })

  // The property the whole queue design rests on. Without SKIP LOCKED two replicas would
  // either block on each other or hand the same token to both, and a user gets the
  // notification twice — which is the one failure mode a push system cannot walk back.
  it('never hands the same delivery to two concurrent claimers', async () => {
    const campaign = await pushDb.createCampaign(newCampaign('concurrency'))
    await pushDb.replaceAudience(
      campaign.id,
      Array.from({ length: 20 }, (_, i) => ({ userId: `user-${i}`, token: `token-${i}` }))
    )
    await pushDb.setStatus(campaign.id, ['draft'], 'pending_approval')
    await pushDb.approveCampaign(campaign.id, APPROVER)

    const [first, second] = await Promise.all([pushDb.claimDeliveries(20), pushDb.claimDeliveries(20)])

    const firstUsers = first.map((d) => d.userId)
    const secondUsers = second.map((d) => d.userId)
    expect(firstUsers.filter((u) => secondUsers.includes(u))).toEqual([])
    expect(new Set([...firstUsers, ...secondUsers]).size).toBe(firstUsers.length + secondUsers.length)
  })

  // A replica that dies between claiming and recording would otherwise strand those
  // deliveries in `sending` forever, and the campaign would never finish.
  it('returns abandoned deliveries to the queue once the lease expires', async () => {
    const campaign = await pushDb.createCampaign(newCampaign('crashed-replica'))
    await pushDb.replaceAudience(campaign.id, [{ userId: 'user-a', token: 'token-a' }])
    await pushDb.setStatus(campaign.id, ['draft'], 'pending_approval')
    await pushDb.approveCampaign(campaign.id, APPROVER)

    expect(await pushDb.claimDeliveries(10)).toHaveLength(1)
    // Claimed but never resolved: nothing else may pick it up yet.
    expect(await pushDb.claimDeliveries(10)).toHaveLength(0)
    expect((await pushDb.getStats(campaign.id)).inFlight).toBe(1)
    // Not drained while something is still in flight.
    expect(await pushDb.finishDrainedCampaigns()).toEqual([])

    // Lease of 0s makes every in-flight row stale immediately.
    expect(await pushDb.reclaimStaleDeliveries(0, 3)).toBe(1)
    expect(await pushDb.claimDeliveries(10)).toHaveLength(1)

    // The expiry spends an attempt of its own, so a replica that keeps dying before it records
    // anything still runs out of budget. Nothing below sets `attempts` by hand: doing that was
    // what hid the row cycling pending->sending->pending forever, since only a completed send
    // used to count.
    expect(await pushDb.reclaimStaleDeliveries(0, 3)).toBe(1)
    expect(await pushDb.claimDeliveries(10)).toHaveLength(1)
    expect(await pushDb.reclaimStaleDeliveries(0, 3)).toBe(1)

    // Budget spent: written off instead of circulating, and nobody can claim it again.
    expect(await pushDb.claimDeliveries(10)).toHaveLength(0)
    const stats = await pushDb.getStats(campaign.id)
    expect(stats).toMatchObject({ failed: 1, pending: 0, inFlight: 0, errors: { LEASE_EXPIRED: 1 } })
  })

  it('refuses to approve a campaign whose audience has gone entirely dead', async () => {
    // Approval needs a queue: reaching `sending` requires claiming a row, and
    // finishDrainedCampaigns only closes campaigns already `sending`. Approved with nothing
    // queued, a campaign sits in `scheduled` for good — never sent, only cancellable by hand.
    const campaign = await pushDb.createCampaign(newCampaign('all-tokens-dead'))
    await pushDb.replaceAudience(campaign.id, [{ userId: 'user-a', token: 'token-a' }])
    await pushDb.setStatus(campaign.id, ['draft'], 'pending_approval')

    // The window submit's own check cannot cover: the audience may be replaced while the
    // campaign waits for an approver, and suppression is applied at upload time.
    await pushDb.markTokensDead([{ token: 'token-a', errorCode: 'UNREGISTERED' }])
    const report = await pushDb.replaceAudience(campaign.id, [{ userId: 'user-a', token: 'token-a' }])
    expect(report).toMatchObject({ valid: 0, suppressed: 1 })

    expect(await pushDb.approveCampaign(campaign.id, APPROVER)).toBeNull()
    expect((await pushDb.getCampaign(campaign.id))?.status).toBe('pending_approval')
  })

  it('cancels what is still queued and leaves what already went out alone', async () => {
    const campaign = await pushDb.createCampaign(newCampaign('cancel-me'))
    await pushDb.replaceAudience(campaign.id, [
      { userId: 'sent-already', token: 'token-1' },
      { userId: 'still-queued', token: 'token-2' }
    ])
    await pushDb.setStatus(campaign.id, ['draft'], 'pending_approval')
    await pushDb.approveCampaign(campaign.id, APPROVER)
    await pushDb.claimDeliveries(1)
    await pushDb.recordOutcomes([{ campaignId: campaign.id, userId: 'sent-already', state: 'sent' }])

    const cancelled = await pushDb.cancelCampaign(campaign.id)
    expect(cancelled?.campaign.status).toBe('cancelled')
    expect(cancelled?.cancelledDeliveries).toBe(1)

    const stats = await pushDb.getStats(campaign.id)
    expect(stats).toMatchObject({ sent: 1, cancelled: 1, pending: 0, inFlight: 0 })
    expect(await pushDb.claimDeliveries(10)).toHaveLength(0)
  })

  async function approvedCampaign(key: string, audience: { userId: string; token: string }[]) {
    const campaign = await pushDb.createCampaign({
      campaignKey: key,
      title: 'Title',
      body: 'Body',
      deepLink: 'decentraland://open?position=0,0',
      imageUrl: null,
      ttlSeconds: 86400,
      scheduledAt: null,
      createdBy: CREATOR
    })
    await pushDb.replaceAudience(campaign.id, audience)
    await pushDb.setStatus(campaign.id, ['draft'], 'pending_approval')
    await pushDb.approveCampaign(campaign.id, APPROVER)
    return campaign
  }

  it('sends an approved campaign and closes it out', async () => {
    const campaign = await approvedCampaign('happy-path', [
      { userId: 'user-a', token: 'token-a' },
      { userId: 'user-b', token: 'token-b' }
    ])
    const dispatcher = await makeDispatcher()

    const result = await dispatcher.tick()

    expect(result).toMatchObject({ claimed: 2, sent: 2, failed: 0, retrying: 0, finishedCampaigns: 1 })
    expect((await pushDb.getCampaign(campaign.id))?.status).toBe('sent')

    // Each delivery carries its own push_id, and the deep link is attributed.
    expect(new Set(sent.map((m) => m.pushId)).size).toBe(2)
    expect(sent[0].deepLink).toContain('push_campaign_id=happy-path')
    expect(sent[0].deepLink).toContain(`push_id=${sent[0].pushId}`)
    expect(sent[0].ttlSeconds).toBe(86400)
  })

  it('retries a transient failure and gives up on a permanent one', async () => {
    const campaign = await approvedCampaign('mixed-fates', [
      { userId: 'flaky', token: 'token-flaky' },
      { userId: 'gone', token: 'token-gone' }
    ])
    const dispatcher = await makeDispatcher()

    respond = (message) =>
      message.token === 'token-gone'
        ? { status: 'error', errorCode: 'UNREGISTERED', retryable: false, tokenIsDead: true }
        : { status: 'error', errorCode: 'UNAVAILABLE', retryable: true, tokenIsDead: false }

    const first = await dispatcher.tick()
    expect(first).toMatchObject({ claimed: 2, sent: 0, failed: 1, retrying: 1 })
    // The campaign is not finished while something is still queued for another attempt.
    expect(first.finishedCampaigns).toBe(0)
    expect((await pushDb.getCampaign(campaign.id))?.status).toBe('sending')

    // The uninstalled device is struck off so the next audience never pays for it again.
    const dead = await pg.query<{ token: string }>('SELECT token FROM push_dead_tokens')
    expect(dead.rows.map((r) => r.token)).toEqual(['token-gone'])

    // Second pass: the retryable one is claimable again, and now it works.
    respond = () => ({ status: 'sent', providerMsgId: 'projects/test/messages/2' })
    const second = await dispatcher.tick()
    expect(second).toMatchObject({ claimed: 1, sent: 1, finishedCampaigns: 1 })
    expect(sent.map((m) => m.token)).toEqual(['token-flaky', 'token-gone', 'token-flaky'])

    const stats = await pushDb.getStats(campaign.id)
    expect(stats).toMatchObject({ sent: 1, failed: 1, pending: 0, inFlight: 0 })
  })

  it('stops retrying a delivery that never lands', async () => {
    const campaign = await approvedCampaign('doomed', [{ userId: 'user-a', token: 'token-a' }])
    const dispatcher = await makeDispatcher()
    respond = () => ({ status: 'error', errorCode: 'UNAVAILABLE', retryable: true, tokenIsDead: false })

    // MAX_ATTEMPTS is 3: two retries, then it is written off rather than circulating forever.
    await dispatcher.tick()
    await dispatcher.tick()
    const third = await dispatcher.tick()

    expect(sent).toHaveLength(3)
    expect(third).toMatchObject({ failed: 1, retrying: 0, finishedCampaigns: 1 })
    expect(await pushDb.claimDeliveries(10)).toHaveLength(0)
    expect((await pushDb.getStats(campaign.id)).errors).toEqual({ UNAVAILABLE: 1 })
  })

  it('sends nothing for a cancelled campaign', async () => {
    const campaign = await approvedCampaign('cancelled', [{ userId: 'user-a', token: 'token-a' }])
    await pushDb.cancelCampaign(campaign.id)
    const dispatcher = await makeDispatcher()

    expect(await dispatcher.tick()).toMatchObject({ claimed: 0, sent: 0 })
    expect(sent).toHaveLength(0)
  })
})
