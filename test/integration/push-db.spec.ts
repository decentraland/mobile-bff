import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import { createMetricsComponent } from '@well-known-components/metrics'
import { createPgComponent, IPgComponent } from '@well-known-components/pg-component'
import { metricDeclarations } from '../../src/metrics'
import { createPushDbComponent, IPushDbComponent } from '../../src/adapters/push-db'

// These tests require a real PostgreSQL database and are designed to run in CI
// Skip locally if PostgreSQL is not available
const runDbTests = process.env.CI === 'true' || process.env.RUN_DB_TESTS === 'true'

;(runDbTests ? describe : describe.skip)('push-db integration tests', () => {
  const CREATOR = '0x1111111111111111111111111111111111111111'
  const APPROVER = '0x2222222222222222222222222222222222222222'

  let pg: IPgComponent
  let pushDb: IPushDbComponent

  beforeAll(async () => {
    // Force test database to avoid messing with local dev data
    process.env.PG_COMPONENT_PSQL_DATABASE = 'mobile_test'

    const config = await createDotEnvConfigComponent({ path: ['.env.default', '.env'] })
    const metrics = await createMetricsComponent(metricDeclarations, { config })
    const logs = await createLogComponent({ metrics })

    pg = await createPgComponent(
      { logs, config, metrics },
      {
        migration: {
          databaseUrl: await getDbConnectionString(config),
          dir: __dirname + '/../../dist/migrations',
          migrationsTable: 'pgmigrations',
          ignorePattern: '.*\\.map',
          direction: 'up'
        }
      }
    )

    await pg.start()
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
  })

  async function getDbConnectionString(config: any): Promise<string> {
    let databaseUrl: string | undefined = await config.getString('PG_COMPONENT_PSQL_CONNECTION_STRING')
    if (!databaseUrl) {
      const dbUser = await config.requireString('PG_COMPONENT_PSQL_USER')
      const dbDatabaseName = await config.requireString('PG_COMPONENT_PSQL_DATABASE')
      const dbPort = await config.requireString('PG_COMPONENT_PSQL_PORT')
      const dbHost = await config.requireString('PG_COMPONENT_PSQL_HOST')
      const dbPassword = await config.requireString('PG_COMPONENT_PSQL_PASSWORD')
      databaseUrl = `postgres://${dbUser}:${dbPassword}@${dbHost}:${dbPort}/${dbDatabaseName}`
    }
    return databaseUrl
  }

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

    // Past the attempt budget it stops circulating and is called failed.
    await pg.query("UPDATE push_deliveries SET attempts = 3 WHERE campaign_id = '" + campaign.id + "'")
    expect(await pushDb.reclaimStaleDeliveries(0, 3)).toBe(1)
    const stats = await pushDb.getStats(campaign.id)
    expect(stats).toMatchObject({ failed: 1, pending: 0, inFlight: 0, errors: { LEASE_EXPIRED: 1 } })
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
    expect(stats).toMatchObject({ sent: 1, cancelled: 1, pending: 0 })
    expect(await pushDb.claimDeliveries(10)).toHaveLength(0)
  })
})
