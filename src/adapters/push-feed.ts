// Fills a recurring campaign's queue from the warehouse's audience feed.
// See decentraland/godot-explorer#2945 and decentraland/monodata#661.
//
// The feed answers a question this service cannot: which installs are on their third day,
// where each one played, and what time 19:00 is for them. That lives in Snowflake because it
// needs the whole event history; what lives here is the sending.
//
// Two properties of the feed shape this code. It is a rolling window rather than a day's
// list: a trigger that came due stays in it for a few days, so the same row is read on
// several consecutive runs and ingestion has to converge on a set rather than replace one.
// And it names campaigns by key, not by uuid, so a campaign still has to be created and
// approved by a person here — the feed fills a queue, it never invents the copy that goes out.

import { IBaseComponent } from '@well-known-components/interfaces'
import { AppComponents } from '../types'
import { CAMPAIGN_KEY_REGEX, deepLinkRouteError, PushPlatform } from '../logic/push'
import { FeedAudienceEntry } from './push-db'
import { SnowflakeRow } from './snowflake'

const FEED_RELATION = 'EXPORT_PUSH_COMEBACK_AUDIENCE'

// Timestamps arrive from the SQL API as an epoch offset, so the feed renders this one to text
// in the query. The trailing Z is what makes it parse as the UTC instant it already is.
const FEED_QUERY = `
  SELECT
    campaign_key,
    visitor_id,
    push_token,
    push_platform,
    deep_link,
    image_url,
    TO_CHAR(send_at_utc, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS send_at
  FROM ${FEED_RELATION}
`

export type SyncReport = {
  rowsRead: number
  /** Rows the feed produced that this service refuses to queue, with the reason counted. */
  rejected: Record<string, number>
  /** Campaign keys the feed named that no campaign here carries. */
  unknownCampaigns: string[]
  /** Campaign keys whose campaign exists but is not open to a feed. */
  notAcceptingCampaigns: string[]
  queued: number
  alreadyQueued: number
  suppressed: number
}

export type IPushFeedComponent = IBaseComponent & {
  /** Runs one ingest. Exposed so the backoffice and the tests can drive it directly. */
  sync(): Promise<SyncReport>
}

/** A campaign only takes feed rows once a second person has approved what it says. */
const INGESTIBLE_STATUSES = ['scheduled', 'sending']

type ParsedRow = { entry: FeedAudienceEntry } | { reason: string }

export function parseFeedRow(row: SnowflakeRow): ParsedRow {
  const campaignKey = (row.campaign_key ?? '').trim()
  if (!CAMPAIGN_KEY_REGEX.test(campaignKey)) {
    return { reason: 'campaign_key' }
  }

  const userId = (row.visitor_id ?? '').trim()
  if (userId.length === 0) {
    return { reason: 'visitor_id' }
  }

  const token = (row.push_token ?? '').trim()
  if (token.length === 0) {
    return { reason: 'push_token' }
  }

  const platform = (row.push_platform ?? '').trim()
  if (platform !== 'android' && platform !== 'ios') {
    return { reason: 'push_platform' }
  }

  const deepLink = (row.deep_link ?? '').trim()
  if (!deepLink.startsWith('decentraland://')) {
    return { reason: 'deep_link_scheme' }
  }
  // The same allow-list a campaign's own link is held to. The feed is another system's
  // output, so what it may route to is checked here rather than assumed.
  if (deepLinkRouteError(deepLink) !== null) {
    return { reason: 'deep_link_route' }
  }

  const rawSendAt = (row.send_at ?? '').trim()
  let sendAt: string | null = null
  if (rawSendAt.length > 0) {
    const parsed = new Date(rawSendAt)
    if (Number.isNaN(parsed.getTime())) {
      return { reason: 'send_at' }
    }
    sendAt = parsed.toISOString()
  }

  const imageUrl = (row.image_url ?? '').trim()

  return {
    entry: {
      campaignKey,
      userId,
      token,
      platform: platform as PushPlatform,
      deepLink,
      imageUrl: imageUrl.length > 0 ? imageUrl : null,
      sendAt
    }
  }
}

export async function createPushFeedComponent({
  config,
  logs,
  pushDb,
  snowflake
}: Pick<AppComponents, 'config' | 'logs' | 'pushDb' | 'snowflake'>): Promise<IPushFeedComponent> {
  const logger = logs.getLogger('push-feed')
  const intervalMs = (await config.getNumber('PUSH_FEED_SYNC_INTERVAL_MS')) ?? 900_000

  let timer: NodeJS.Timeout | undefined
  let running = false

  async function sync(): Promise<SyncReport> {
    const report: SyncReport = {
      rowsRead: 0,
      rejected: {},
      unknownCampaigns: [],
      notAcceptingCampaigns: [],
      queued: 0,
      alreadyQueued: 0,
      suppressed: 0
    }

    if (!snowflake.isConfigured()) {
      logger.info('Skipping feed sync: Snowflake is not configured')
      return report
    }

    const rows = await snowflake.query(FEED_QUERY)
    report.rowsRead = rows.length

    const byCampaign = new Map<string, FeedAudienceEntry[]>()
    for (const row of rows) {
      const parsed = parseFeedRow(row)
      if ('reason' in parsed) {
        report.rejected[parsed.reason] = (report.rejected[parsed.reason] ?? 0) + 1
        continue
      }
      const bucket = byCampaign.get(parsed.entry.campaignKey)
      if (bucket) {
        bucket.push(parsed.entry)
      } else {
        byCampaign.set(parsed.entry.campaignKey, [parsed.entry])
      }
    }

    for (const [campaignKey, entries] of byCampaign) {
      const campaign = await pushDb.getCampaignByKey(campaignKey)
      if (!campaign) {
        report.unknownCampaigns.push(campaignKey)
        continue
      }
      if (!campaign.isRecurring || !INGESTIBLE_STATUSES.includes(campaign.status)) {
        report.notAcceptingCampaigns.push(campaignKey)
        continue
      }

      const result = await pushDb.mergeAudience(campaign.id, entries)
      report.queued += result.queued
      report.alreadyQueued += result.alreadyQueued
      report.suppressed += result.suppressed
    }

    if (report.rowsRead > 0 || Object.keys(report.rejected).length > 0) {
      logger.info('Feed sync', {
        rowsRead: report.rowsRead,
        queued: report.queued,
        alreadyQueued: report.alreadyQueued,
        suppressed: report.suppressed,
        rejected: JSON.stringify(report.rejected),
        unknownCampaigns: report.unknownCampaigns.join(',') || 'none',
        notAcceptingCampaigns: report.notAcceptingCampaigns.join(',') || 'none'
      })
    }

    return report
  }

  async function start() {
    // Same reasoning as the dispatcher's timer: the integration suite boots the real app, and
    // a live sync would reach for Snowflake and rewrite rows a test is asserting on.
    if (intervalMs <= 0) {
      logger.info('Push feed sync timer disabled', { intervalMs })
      return
    }
    if (!snowflake.isConfigured()) {
      logger.info('Push feed sync timer not started: Snowflake is not configured')
      return
    }
    logger.info('Starting push feed sync', { intervalMs })
    timer = setInterval(async () => {
      if (running) {
        return
      }
      running = true
      try {
        await sync()
      } catch (error) {
        // The feed is a rolling window, so a failed sync loses nothing: whatever was missed is
        // still there on the next pass, for as many days as the trigger tolerates.
        logger.error('Feed sync failed', { error: (error as Error).message })
      } finally {
        running = false
      }
    }, intervalMs)
    timer.unref()
  }

  async function stop() {
    if (timer) {
      clearInterval(timer)
      timer = undefined
    }
  }

  return { start, stop, sync }
}
