import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import { createMetricsComponent } from '@well-known-components/metrics'
import { IPgComponent } from '@well-known-components/pg-component'
import { metricDeclarations } from '../../src/metrics'
import { startPgWithMigrations } from '../utils/pg'
import { createPushDbComponent, FeedAudienceEntry, IPushDbComponent } from '../../src/adapters/push-db'
import { createPushFeedComponent } from '../../src/adapters/push-feed'
import { ISnowflakeComponent, SnowflakeRow } from '../../src/adapters/snowflake'

const runDbTests = process.env.CI === 'true' || process.env.RUN_DB_TESTS === 'true'

;(runDbTests ? describe : describe.skip)('warehouse-fed campaigns', () => {
  const CREATOR = '0x1111111111111111111111111111111111111111'
  const APPROVER = '0x2222222222222222222222222222222222222222'

  let pg: IPgComponent
  let pushDb: IPushDbComponent

  beforeAll(async () => {
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
    await pg.query('DELETE FROM push_campaigns')
    await pg.query('DELETE FROM push_dead_tokens')
  })

  async function approvedRecurringCampaign(key: string, triggerKey = 'd3', destinationKind = 'scene') {
    const campaign = await pushDb.createCampaign({
      campaignKey: key,
      title: 'Your spot is still there',
      body: 'Jump back in',
      deepLink: 'decentraland://places',
      imageUrl: null,
      ttlSeconds: 86400,
      scheduledAt: null,
      isRecurring: true,
      triggerKey,
      destinationKind: destinationKind as any,
      createdBy: CREATOR
    })
    await pushDb.setStatus(campaign.id, ['draft'], 'pending_approval')
    await pushDb.approveCampaign(campaign.id, APPROVER)
    return campaign
  }

  function feedRow(userId: string, overrides: Partial<FeedAudienceEntry> = {}): FeedAudienceEntry {
    return {
      userId,
      triggerKey: 'd3',
      destinationKind: 'scene',
      token: `token-${userId}`,
      platform: 'android',
      deepLink: 'decentraland://open?position=-7,-2',
      placeId: 'c2f9b1a4-7e55-4f0d-9a3c-1b8e6d204f71',
      sendAt: null,
      ...overrides
    }
  }

  // The feed is a rolling window: a trigger stays in it for days, so the same row is read on
  // several consecutive runs. This is the property that makes that harmless.
  it('adds what is new and leaves what it already holds alone', async () => {
    const campaign = await approvedRecurringCampaign('d3-comeback')

    const first = await pushDb.mergeAudience(campaign.id, [feedRow('alice'), feedRow('bob')])
    expect(first).toEqual({ queued: 2, alreadyQueued: 0, suppressed: 0 })

    // Alice's push goes out between the two reads.
    const claimed = await pushDb.claimDeliveries(10)
    expect(claimed).toHaveLength(2)
    await pushDb.recordOutcomes(claimed.map((d) => ({ ...d, state: 'sent' as const })))

    const second = await pushDb.mergeAudience(campaign.id, [feedRow('alice'), feedRow('bob'), feedRow('carol')])
    expect(second).toEqual({ queued: 1, alreadyQueued: 2, suppressed: 0 })

    // The two that already went out stay sent rather than being queued a second time, which
    // is exactly what replacing the audience would have got wrong.
    const states = await pg.query<{ user_id: string; state: string }>(
      `SELECT user_id, state FROM push_deliveries WHERE campaign_id = '${campaign.id}' ORDER BY user_id`
    )
    expect(states.rows).toEqual([
      { user_id: 'alice', state: 'sent' },
      { user_id: 'bob', state: 'sent' },
      { user_id: 'carol', state: 'pending' }
    ])
    expect((await pushDb.getCampaign(campaign.id))!.audienceCount).toBe(3)
  })

  it('suppresses a row whose token the provider already rejected', async () => {
    const campaign = await approvedRecurringCampaign('d3-comeback')
    await pushDb.markTokensDead([{ token: 'token-alice', errorCode: 'UNREGISTERED' }])

    expect(await pushDb.mergeAudience(campaign.id, [feedRow('alice'), feedRow('bob')])).toEqual({
      queued: 1,
      alreadyQueued: 0,
      suppressed: 1
    })
  })

  // Every row lands at the same local hour, which is a different instant per install, so the
  // queue holds rows that are not due yet.
  it('claims a row whose moment has passed and holds one whose moment has not', async () => {
    const campaign = await approvedRecurringCampaign('d3-comeback')
    const past = new Date(Date.now() - 60_000).toISOString()
    const future = new Date(Date.now() + 3_600_000).toISOString()

    await pushDb.mergeAudience(campaign.id, [
      feedRow('overdue', { sendAt: past }),
      feedRow('later', { sendAt: future })
    ])

    const claimed = await pushDb.claimDeliveries(10)
    expect(claimed.map((d) => d.userId)).toEqual(['overdue'])
  })

  it('sends the row to its own destination rather than the campaign default', async () => {
    const campaign = await approvedRecurringCampaign('d3-comeback')
    await pushDb.mergeAudience(campaign.id, [
      feedRow('played', { deepLink: 'decentraland://open?realm=monkichi.dcl.eth' }),
      // A row with no destination of its own falls back to the campaign's, which is what every
      // plaza and Discover row does and how a hand-uploaded audience keeps working unchanged.
      feedRow('no-destination', { deepLink: null, placeId: null })
    ])

    const claimed = await pushDb.claimDeliveries(10)
    const byUser = new Map(claimed.map((d) => [d.userId, d]))
    expect(byUser.get('played')!.deepLink).toBe('decentraland://open?realm=monkichi.dcl.eth')
    expect(byUser.get('played')!.placeId).toBe('c2f9b1a4-7e55-4f0d-9a3c-1b8e6d204f71')
    // The campaign's own link, and no place to resolve a thumbnail from.
    expect(byUser.get('no-destination')!.deepLink).toBe('decentraland://places')
    expect(byUser.get('no-destination')!.placeId).toBeNull()
  })

  // The reason the feed stopped naming campaigns. A destination can change while a trigger is
  // still in the window, which moves the install to the campaign serving the other slice. Keyed
  // on the campaign that read as a new member and sent the same trigger a second time.
  it('refuses a second send of the same trigger when the destination moves between campaigns', async () => {
    const scene = await approvedRecurringCampaign('d3-comeback', 'd3', 'scene')
    const plaza = await approvedRecurringCampaign('d3-comeback-plaza', 'd3', 'plaza')

    expect(await pushDb.mergeAudience(plaza.id, [feedRow('alice', { deepLink: null, placeId: null })])).toEqual({
      queued: 1,
      alreadyQueued: 0,
      suppressed: 0
    })

    // Next build resolves a scene for alice, so she arrives under the other campaign.
    expect(await pushDb.mergeAudience(scene.id, [feedRow('alice')])).toEqual({
      queued: 0,
      alreadyQueued: 1,
      suppressed: 0
    })

    const rows = await pg.query<{ campaign_id: string }>(
      `SELECT campaign_id FROM push_deliveries WHERE user_id = 'alice'`
    )
    expect(rows.rows).toEqual([{ campaign_id: plaza.id }])

    // A different trigger for the same install is a different send and still goes through.
    const d7 = await approvedRecurringCampaign('d7-comeback', 'd7', 'scene')
    expect(await pushDb.mergeAudience(d7.id, [feedRow('alice', { triggerKey: 'd7' })])).toMatchObject({
      queued: 1
    })
  })

  // The bug this whole shape exists to avoid: a drained queue closing a campaign that is
  // supposed to be refilled tomorrow.
  it('returns a drained recurring campaign to scheduled so the next ingest starts it again', async () => {
    const recurring = await approvedRecurringCampaign('d3-comeback')
    await pushDb.mergeAudience(recurring.id, [feedRow('alice')])

    const claimed = await pushDb.claimDeliveries(10)
    await pushDb.recordOutcomes(claimed.map((d) => ({ ...d, state: 'sent' as const })))

    expect(await pushDb.finishDrainedCampaigns()).toEqual([recurring.id])
    const idle = (await pushDb.getCampaign(recurring.id))!
    expect(idle.status).toBe('scheduled')
    expect(idle.finishedAt).toBeNull()

    // Tomorrow's rows are claimable, which they would not be from `sent`.
    await pushDb.mergeAudience(recurring.id, [feedRow('bob')])
    expect((await pushDb.claimDeliveries(10)).map((d) => d.userId)).toEqual(['bob'])
  })

  it('still closes a one-shot campaign for good', async () => {
    const campaign = await pushDb.createCampaign({
      campaignKey: 'spring-event',
      title: 'Title',
      body: 'Body',
      deepLink: 'decentraland://open?position=0,0',
      imageUrl: null,
      ttlSeconds: 86400,
      scheduledAt: null,
      isRecurring: false,
      triggerKey: null,
      destinationKind: null,
      createdBy: CREATOR
    })
    await pushDb.replaceAudience(campaign.id, [{ userId: 'alice', token: 'token-alice', platform: 'android' }])
    await pushDb.setStatus(campaign.id, ['draft'], 'pending_approval')
    await pushDb.approveCampaign(campaign.id, APPROVER)

    const claimed = await pushDb.claimDeliveries(10)
    await pushDb.recordOutcomes(claimed.map((d) => ({ ...d, state: 'sent' as const })))

    expect(await pushDb.finishDrainedCampaigns()).toEqual([campaign.id])
    const done = (await pushDb.getCampaign(campaign.id))!
    expect(done.status).toBe('sent')
    expect(done.finishedAt).not.toBeNull()
  })

  describe('sync', () => {
    function fakeSnowflake(rows: SnowflakeRow[]): ISnowflakeComponent {
      return { isConfigured: () => true, query: async () => rows }
    }

    async function feedComponent(snowflake: ISnowflakeComponent) {
      const config = await createDotEnvConfigComponent({ path: ['.env.default', '.env'] })
      const metrics = await createMetricsComponent(metricDeclarations, { config })
      const logs = await createLogComponent({ metrics })
      // The suite drives sync() itself, so the interval is forced to 0: a live timer would
      // reach for the warehouse and rewrite rows these assertions are reading.
      const withoutTimer = { ...config, getNumber: async () => 0 }
      return createPushFeedComponent({ config: withoutTimer, logs, pushDb, snowflake } as any)
    }

    function snowflakeRow(triggerKey: string, userId: string): SnowflakeRow {
      return {
        visitor_id: userId,
        trigger_key: triggerKey,
        destination_kind: 'scene',
        push_token: `token-${userId}`,
        push_platform: 'ios',
        is_world: 'false',
        world_name: null,
        base_position: '1,1',
        place_id: 'c2f9b1a4-7e55-4f0d-9a3c-1b8e6d204f71',
        send_at: '2026-10-04T22:00:00Z'
      }
    }

    it('fills the slices it can and names the ones it cannot', async () => {
      const campaign = await approvedRecurringCampaign('d3-comeback', 'd3', 'scene')
      // Approved but one-shot: a feed must not quietly take over a campaign somebody is
      // running by hand.
      const oneShot = await pushDb.createCampaign({
        campaignKey: 'd7-comeback',
        title: 'Title',
        body: 'Body',
        deepLink: 'decentraland://places',
        imageUrl: null,
        ttlSeconds: 86400,
        scheduledAt: null,
        isRecurring: false,
        triggerKey: 'd7',
        destinationKind: 'scene',
        createdBy: CREATOR
      })
      await pushDb.setStatus(oneShot.id, ['draft'], 'pending_approval')
      await pushDb.approveCampaign(oneShot.id, APPROVER)

      const feed = await feedComponent(
        fakeSnowflake([
          snowflakeRow('d3', 'alice'),
          snowflakeRow('d7', 'bob'),
          snowflakeRow('d30', 'carol'),
          { ...snowflakeRow('d3', 'dave'), push_platform: 'web' }
        ])
      )

      const report = await feed.sync()

      expect(report.rowsRead).toBe(4)
      expect(report.queued).toBe(1)
      expect(report.rejected).toEqual({ push_platform: 1 })
      expect(report.unservedSlices).toEqual(['d30/scene'])
      expect(report.notAcceptingSlices).toEqual(['d7/scene'])
      expect((await pushDb.getCampaign(campaign.id))!.audienceCount).toBe(1)
      expect((await pushDb.getCampaign(oneShot.id))!.audienceCount).toBe(0)
    })

    it('does nothing at all when the warehouse is not configured', async () => {
      await approvedRecurringCampaign('d3-comeback')
      const feed = await feedComponent({
        isConfigured: () => false,
        query: async () => {
          throw new Error('must not be queried')
        }
      })

      expect(await feed.sync()).toMatchObject({ rowsRead: 0, queued: 0 })
    })
  })
})
