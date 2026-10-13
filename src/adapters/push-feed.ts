// Fills a recurring campaign's queue from the warehouse's audience feed.
// See decentraland/godot-explorer#2945 and decentraland/monodata#661.
//
// The feed answers a question this service cannot: which installs are on their third day,
// where each one played, and what time 19:00 is for them. That lives in Snowflake because it
// needs the whole event history; what lives here is the sending.
//
// Two properties of the feed shape this code. It is a rolling window rather than a day's
// list: a trigger that came due stays in it for a few days, so the same row is read on
// several consecutive runs and ingestion has to converge on a set rather than replace one —
// and on the feed's own grain, one send per install per trigger, because a destination can
// change while the trigger is still in the window.
//
// And it does not name campaigns. It publishes a trigger and a kind of destination, and a
// campaign here declares which pair it serves, so a campaign is still created and approved by
// a person — the feed fills a queue, it never invents the copy that goes out.

import { IBaseComponent } from '@well-known-components/interfaces'
import { AppComponents } from '../types'
import {
  deepLinkRouteError,
  destinationDeepLink,
  FEED_DESTINATION_KINDS,
  FeedDestinationKind,
  isWellFormedToken,
  PushPlatform
} from '../logic/push'
import { FeedAudienceEntry } from './push-db'
import { SnowflakeRow } from './snowflake'

const FEED_RELATION = 'EXPORT_PUSH_COMEBACK_AUDIENCE'

// The feed is trusted for who to reach, but not without bound: every row it produces becomes a
// push, so a warehouse bug or a bad actor with write access to the export could have this
// service send any number of them. Rows past this many are a build gone wrong, and the whole
// read is refused rather than half of it queued. It is also what keeps a run's memory bounded,
// since the result and the insert that follows are both held whole.
const DEFAULT_MAX_ROWS = 100_000

// Timestamps arrive from the SQL API as an epoch offset, so the feed renders this one to text
// in the query. The trailing Z is what makes it parse as the UTC instant it already is.
const FEED_QUERY = `
  SELECT
    visitor_id,
    trigger_key,
    destination_kind,
    push_token,
    push_platform,
    is_world,
    world_name,
    base_position,
    place_id,
    TO_CHAR(send_at_utc, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS send_at
  FROM ${FEED_RELATION}
`

export type SyncReport = {
  rowsRead: number
  /** Rows the feed produced that this service refuses to queue, with the reason counted. */
  rejected: Record<string, number>
  /** Slices the feed produced rows for that no campaign here declares, as `trigger/kind`. */
  unservedSlices: string[]
  /** Slices whose campaign exists but is not open to a feed. */
  notAcceptingSlices: string[]
  queued: number
  alreadyQueued: number
  suppressed: number
}

export type IPushFeedComponent = IBaseComponent & {
  /** Runs one ingest. Exposed so the backoffice and the tests can drive it directly. */
  sync(): Promise<SyncReport>
}

/**
 * A sync this service declined to carry out. Unlike a warehouse error, the message is this
 * service's own and names what an operator has to act on, so it is safe to send back to them.
 */
export class FeedRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FeedRefusedError'
  }
}

/** A campaign only takes feed rows once a second person has approved what it says. */
const INGESTIBLE_STATUSES = ['scheduled', 'sending']

type ParsedRow = { entry: FeedAudienceEntry } | { reason: string }

function readBoolean(value: string | null | undefined): boolean | null {
  if (value === undefined || value === null) {
    return null
  }
  const text = String(value).trim().toLowerCase()
  if (text === 'true') {
    return true
  }
  if (text === 'false') {
    return false
  }
  return null
}

export function parseFeedRow(row: SnowflakeRow): ParsedRow {
  const triggerKey = (row.trigger_key ?? '').trim()
  if (triggerKey.length === 0) {
    return { reason: 'trigger_key' }
  }

  const destinationKind = (row.destination_kind ?? '').trim() as FeedDestinationKind
  if (!FEED_DESTINATION_KINDS.includes(destinationKind)) {
    return { reason: 'destination_kind' }
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
  // The platform is declared rather than read off the token, so the two are checked against
  // each other: an iOS token ends up in the path of the request to Apple, and anything that is
  // not the 64 hex characters of a device token would rewrite that path.
  if (!isWellFormedToken(token, platform)) {
    return { reason: 'push_token' }
  }

  // A scene row has to produce a link; plaza and discover carry no destination of their own
  // and fall back to their campaign's. A scene whose identity the warehouse could not express
  // is rejected rather than quietly sent to the campaign's generic link.
  const deepLink = destinationDeepLink({
    isWorld: readBoolean(row.is_world),
    worldName: row.world_name ?? null,
    basePosition: row.base_position ?? null
  })
  if (destinationKind === 'scene' && deepLink === null) {
    return { reason: 'destination_identity' }
  }
  // The same allow-list a campaign's own link is held to. Built here rather than taken from
  // the feed, but still checked, so the two can never drift apart.
  if (deepLink !== null && deepLinkRouteError(deepLink) !== null) {
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

  const placeId = (row.place_id ?? '').trim()

  return {
    entry: {
      userId,
      triggerKey,
      destinationKind,
      token,
      platform: platform as PushPlatform,
      deepLink,
      placeId: placeId.length > 0 ? placeId : null,
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
  // Hourly. The warehouse builds the feed once a day, and a row is held by the claim until its
  // own `send_at`, so reading more often buys nothing and costs warehouse credits.
  const intervalMs = (await config.getNumber('PUSH_FEED_SYNC_INTERVAL_MS')) ?? 3_600_000
  const maxRows = positiveOr(await config.getNumber('PUSH_FEED_MAX_ROWS'), DEFAULT_MAX_ROWS)

  let timer: NodeJS.Timeout | undefined
  let running = false

  // The guard is here rather than only in the timer so the backoffice's manual sync cannot
  // overlap one already in flight. Two at once would be survivable — ON CONFLICT DO NOTHING
  // absorbs the repeat — but it would double the read for nothing.
  async function sync(): Promise<SyncReport> {
    if (running) {
      logger.info('Skipping feed sync: one is already in flight')
      return emptyReport()
    }
    running = true
    try {
      return await runSync()
    } finally {
      running = false
    }
  }

  function emptyReport(): SyncReport {
    return {
      rowsRead: 0,
      rejected: {},
      unservedSlices: [],
      notAcceptingSlices: [],
      queued: 0,
      alreadyQueued: 0,
      suppressed: 0
    }
  }

  async function runSync(): Promise<SyncReport> {
    const report: SyncReport = {
      rowsRead: 0,
      rejected: {},
      unservedSlices: [],
      notAcceptingSlices: [],
      queued: 0,
      alreadyQueued: 0,
      suppressed: 0
    }

    if (!snowflake.isConfigured()) {
      logger.info('Skipping feed sync: Snowflake is not configured')
      return report
    }

    // One past the cap, so a feed that is exactly at it is told apart from one that is over.
    const rows = await snowflake.query(`${FEED_QUERY} LIMIT ${maxRows + 1}`)
    if (rows.length > maxRows) {
      throw new FeedRefusedError(
        `the warehouse feed holds more than ${maxRows} rows (PUSH_FEED_MAX_ROWS); nothing was queued`
      )
    }
    report.rowsRead = rows.length

    const bySlice = new Map<string, FeedAudienceEntry[]>()
    // One send per device per trigger. The feed's grain is the install, and a device can show
    // up as more than one — a reinstall keeps its old row until that token dies — so the same
    // token under two visitor ids would be the same push twice, and the delivery guard, keyed
    // on the install, could not see it.
    const seenDevices = new Set<string>()
    for (const row of rows) {
      const parsed = parseFeedRow(row)
      if ('reason' in parsed) {
        report.rejected[parsed.reason] = (report.rejected[parsed.reason] ?? 0) + 1
        continue
      }
      const device = `${parsed.entry.triggerKey}\u0000${parsed.entry.token}`
      if (seenDevices.has(device)) {
        report.rejected.duplicate_token = (report.rejected.duplicate_token ?? 0) + 1
        continue
      }
      seenDevices.add(device)
      const slice = `${parsed.entry.triggerKey}/${parsed.entry.destinationKind}`
      const bucket = bySlice.get(slice)
      if (bucket) {
        bucket.push(parsed.entry)
      } else {
        bySlice.set(slice, [parsed.entry])
      }
    }

    for (const [slice, entries] of bySlice) {
      const { triggerKey, destinationKind } = entries[0]
      const campaign = await pushDb.getCampaignForSlice(triggerKey, destinationKind)
      if (!campaign) {
        report.unservedSlices.push(slice)
        continue
      }
      if (!campaign.isRecurring || !INGESTIBLE_STATUSES.includes(campaign.status)) {
        report.notAcceptingSlices.push(slice)
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
        unservedSlices: report.unservedSlices.join(',') || 'none',
        notAcceptingSlices: report.notAcceptingSlices.join(',') || 'none'
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
      try {
        await sync()
      } catch (error) {
        // The feed is a rolling window, so a failed sync loses nothing: whatever was missed is
        // still there on the next pass, for as many days as the trigger tolerates.
        logger.error('Feed sync failed', { error: (error as Error).message })
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

/** A config number that is absent, empty or non-positive falls back rather than disabling. */
function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}
