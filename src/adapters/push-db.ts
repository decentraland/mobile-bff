import SQL from 'sql-template-strings'
import { AppComponents } from '../types'
import { PushPlatform } from '../logic/push'

export type PushCampaignStatus =
  | 'draft'
  | 'pending_approval'
  | 'scheduled'
  | 'sending'
  | 'sent'
  | 'cancelled'
  | 'failed'

export type PushDeliveryState = 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled'

export type PushCampaign = {
  id: string
  campaignKey: string
  title: string
  body: string
  deepLink: string
  imageUrl: string | null
  category: string
  status: PushCampaignStatus
  ttlSeconds: number
  scheduledAt: string | null
  /** A campaign the warehouse feed keeps refilling, which therefore never finishes. */
  isRecurring: boolean
  audienceCount: number
  createdBy: string
  approvedBy: string | null
  approvedAt: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

export type CreatePushCampaignInput = {
  campaignKey: string
  title: string
  body: string
  deepLink: string
  imageUrl: string | null
  ttlSeconds: number
  scheduledAt: string | null
  isRecurring: boolean
  createdBy: string
}

export type UpdatePushCampaignInput = {
  title: string
  body: string
  deepLink: string
  imageUrl: string | null
  ttlSeconds: number
  scheduledAt: string | null
  isRecurring: boolean
}

/** One row of the uploaded audience. */
export type AudienceEntry = { userId: string; token: string; platform: PushPlatform }

/**
 * One row of the warehouse feed. Unlike a CSV row it carries its own destination and its own
 * moment, because the trigger that produced it is per install rather than per campaign.
 */
export type FeedAudienceEntry = {
  campaignKey: string
  userId: string
  token: string
  platform: PushPlatform
  deepLink: string
  imageUrl: string | null
  sendAt: string | null
}

export type FeedAudienceReport = {
  /** Rows written as new `pending` deliveries. */
  queued: number
  /** Rows the campaign already holds, which is the normal case on a rolling feed. */
  alreadyQueued: number
  /** Tokens the provider already told us are gone. */
  suppressed: number
}

export type AudienceReport = {
  received: number
  /** Rows written to push_deliveries as `pending`. */
  valid: number
  /** Same user_id appearing more than once in the upload. */
  duplicates: number
  /** Tokens the provider already told us are gone. */
  suppressed: number
}

/** A delivery claimed by the dispatcher, joined with what it needs to send. */
export type ClaimedDelivery = {
  campaignId: string
  userId: string
  token: string
  platform: PushPlatform
  campaignKey: string
  title: string
  body: string
  /** The delivery's own destination when it has one, else the campaign's. */
  deepLink: string
  imageUrl: string | null
  category: string
  ttlSeconds: number
  /** Attempts already spent, so the sender can stop retrying a delivery that never lands. */
  attempts: number
}

export type DeliveryOutcome = {
  campaignId: string
  userId: string
  state: PushDeliveryState
  providerMsgId?: string | null
  errorCode?: string | null
}

export type CampaignStats = {
  attempted: number
  sent: number
  failed: number
  pending: number
  cancelled: number
  /** Handed to a sender and not yet resolved. */
  inFlight: number
  /** Failure counts keyed by the provider error code. */
  errors: Record<string, number>
}

export type IPushDbComponent = {
  listCampaigns(): Promise<PushCampaign[]>
  getCampaign(id: string): Promise<PushCampaign | null>
  /** Resolves the key the warehouse feed names to the campaign a person created here. */
  getCampaignByKey(campaignKey: string): Promise<PushCampaign | null>
  createCampaign(input: CreatePushCampaignInput): Promise<PushCampaign>
  updateCampaign(id: string, changes: UpdatePushCampaignInput): Promise<PushCampaign | null>
  /** Moves a campaign between states, refusing transitions that are not allowed. */
  setStatus(id: string, from: PushCampaignStatus[], to: PushCampaignStatus): Promise<PushCampaign | null>
  approveCampaign(id: string, approvedBy: string): Promise<PushCampaign | null>
  cancelCampaign(id: string): Promise<{ campaign: PushCampaign; cancelledDeliveries: number } | null>
  replaceAudience(campaignId: string, entries: AudienceEntry[]): Promise<AudienceReport>
  /** Adds what is new and leaves what is already queued untouched. */
  mergeAudience(campaignId: string, entries: FeedAudienceEntry[]): Promise<FeedAudienceReport>
  /** Claims up to `limit` pending deliveries for sending. Safe across replicas. */
  claimDeliveries(limit: number): Promise<ClaimedDelivery[]>
  /** Returns deliveries abandoned mid-send (crashed replica) to the queue. */
  reclaimStaleDeliveries(leaseSeconds: number, maxAttempts: number): Promise<number>
  recordOutcomes(outcomes: DeliveryOutcome[]): Promise<void>
  markTokensDead(tokens: { token: string; errorCode: string }[]): Promise<void>
  /** Closes out campaigns whose queue has drained. */
  finishDrainedCampaigns(): Promise<string[]>
  getStats(campaignId: string): Promise<CampaignStats>
}

type CampaignRow = {
  id: string
  campaign_key: string
  title: string
  body: string
  deep_link: string
  image_url: string | null
  category: string
  status: PushCampaignStatus
  ttl_seconds: number
  scheduled_at: Date | null
  is_recurring: boolean
  audience_count: number
  created_by: string
  approved_by: string | null
  approved_at: Date | null
  created_at: Date
  started_at: Date | null
  finished_at: Date | null
}

const CAMPAIGN_COLUMNS = `
  id, campaign_key, title, body, deep_link, image_url, category, status, ttl_seconds,
  scheduled_at, is_recurring, audience_count, created_by, approved_by, approved_at,
  created_at, started_at, finished_at
`

const iso = (value: Date | null) => (value ? value.toISOString() : null)

function toCampaign(row: CampaignRow): PushCampaign {
  return {
    id: row.id,
    campaignKey: row.campaign_key,
    title: row.title,
    body: row.body,
    deepLink: row.deep_link,
    imageUrl: row.image_url,
    category: row.category,
    status: row.status,
    ttlSeconds: row.ttl_seconds,
    scheduledAt: iso(row.scheduled_at),
    isRecurring: row.is_recurring,
    audienceCount: row.audience_count,
    createdBy: row.created_by,
    approvedBy: row.approved_by,
    approvedAt: iso(row.approved_at),
    createdAt: row.created_at.toISOString(),
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at)
  }
}

export async function createPushDbComponent({ pg }: Pick<AppComponents, 'pg'>): Promise<IPushDbComponent> {
  async function listCampaigns(): Promise<PushCampaign[]> {
    const query = SQL`SELECT `.append(CAMPAIGN_COLUMNS).append(' FROM push_campaigns ORDER BY created_at DESC')
    const result = await pg.query<CampaignRow>(query)
    return result.rows.map(toCampaign)
  }

  async function getCampaign(id: string): Promise<PushCampaign | null> {
    const query = SQL`SELECT `.append(CAMPAIGN_COLUMNS).append(SQL` FROM push_campaigns WHERE id = ${id}`)
    const result = await pg.query<CampaignRow>(query)
    return result.rows.length > 0 ? toCampaign(result.rows[0]) : null
  }

  async function getCampaignByKey(campaignKey: string): Promise<PushCampaign | null> {
    const query = SQL`SELECT `
      .append(CAMPAIGN_COLUMNS)
      .append(SQL` FROM push_campaigns WHERE campaign_key = ${campaignKey}`)
    const result = await pg.query<CampaignRow>(query)
    return result.rows.length > 0 ? toCampaign(result.rows[0]) : null
  }

  async function createCampaign(input: CreatePushCampaignInput): Promise<PushCampaign> {
    const query = SQL`
      INSERT INTO push_campaigns (campaign_key, title, body, deep_link, image_url, ttl_seconds,
                                  scheduled_at, is_recurring, created_by)
      VALUES (${input.campaignKey}, ${input.title}, ${input.body}, ${input.deepLink}, ${input.imageUrl},
              ${input.ttlSeconds}, ${input.scheduledAt}, ${input.isRecurring}, ${input.createdBy})
      RETURNING `.append(CAMPAIGN_COLUMNS)
    const result = await pg.query<CampaignRow>(query)
    return toCampaign(result.rows[0])
  }

  // Content is only editable while a campaign is still a draft. Once it is submitted the
  // approver is vouching for specific words, so letting the creator rewrite them afterwards
  // would make the two-man rule decorative.
  async function updateCampaign(id: string, changes: UpdatePushCampaignInput): Promise<PushCampaign | null> {
    const query = SQL`
      UPDATE push_campaigns SET
        title = ${changes.title},
        body = ${changes.body},
        deep_link = ${changes.deepLink},
        image_url = ${changes.imageUrl},
        ttl_seconds = ${changes.ttlSeconds},
        scheduled_at = ${changes.scheduledAt},
        is_recurring = ${changes.isRecurring}
      WHERE id = ${id} AND status = 'draft'
      RETURNING `.append(CAMPAIGN_COLUMNS)
    const result = await pg.query<CampaignRow>(query)
    return result.rows.length > 0 ? toCampaign(result.rows[0]) : null
  }

  // The `from` filter is in the UPDATE rather than a read-then-write, so two concurrent
  // approvals of the same campaign cannot both win.
  async function setStatus(
    id: string,
    from: PushCampaignStatus[],
    to: PushCampaignStatus
  ): Promise<PushCampaign | null> {
    const query = SQL`
      UPDATE push_campaigns SET status = ${to}
      WHERE id = ${id} AND status = ANY(${from})
      RETURNING `.append(CAMPAIGN_COLUMNS)
    const result = await pg.query<CampaignRow>(query)
    return result.rows.length > 0 ? toCampaign(result.rows[0]) : null
  }

  async function approveCampaign(id: string, approvedBy: string): Promise<PushCampaign | null> {
    // created_by <> approved_by is also a table constraint; keeping it in the WHERE means a
    // self-approval comes back as "not approvable" instead of a 500 from the check violation.
    //
    // audience_count > 0 because a campaign with nothing queued can never leave `scheduled`:
    // reaching `sending` requires claiming a row, and finishDrainedCampaigns only closes
    // campaigns already `sending`. Submit checks this too, but the audience can be replaced
    // with an all-suppressed one while the campaign sits in `pending_approval`.
    //
    // A recurring campaign is approved empty on purpose: approval is what opens it to the
    // warehouse feed, so requiring an audience first would be a deadlock — the feed only
    // fills campaigns a second person has already approved.
    const query = SQL`
      UPDATE push_campaigns
      SET status = 'scheduled', approved_by = ${approvedBy}, approved_at = now()
      WHERE id = ${id} AND status = 'pending_approval' AND created_by <> ${approvedBy}
        AND (is_recurring OR audience_count > 0)
      RETURNING `.append(CAMPAIGN_COLUMNS)
    const result = await pg.query<CampaignRow>(query)
    return result.rows.length > 0 ? toCampaign(result.rows[0]) : null
  }

  // Kill switch. Cancels the campaign and everything still queued; deliveries already sent
  // are left alone, because they are gone and saying otherwise would make the stats lie.
  async function cancelCampaign(id: string): Promise<{ campaign: PushCampaign; cancelledDeliveries: number } | null> {
    const updated = await setStatus(id, ['draft', 'pending_approval', 'scheduled', 'sending'], 'cancelled')
    if (!updated) {
      return null
    }
    const result = await pg.query(SQL`
      UPDATE push_deliveries SET state = 'cancelled'
      WHERE campaign_id = ${id} AND state = 'pending'
    `)
    return { campaign: updated, cancelledDeliveries: result.rowCount ?? 0 }
  }

  // Replaces the whole audience: uploading a new CSV is "this is the list", not "add these".
  // Deduplication is by user_id (the primary key), so the last row for a user wins — which is
  // also what keeps one person from getting the same campaign twice.
  async function replaceAudience(campaignId: string, entries: AudienceEntry[]): Promise<AudienceReport> {
    const received = entries.length

    const byUser = new Map<string, { token: string; platform: PushPlatform }>()
    for (const entry of entries) {
      byUser.set(entry.userId, { token: entry.token, platform: entry.platform })
    }
    const duplicates = received - byUser.size

    const client = await pg.getPool().connect()
    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM push_deliveries WHERE campaign_id = $1', [campaignId])

      let valid = 0
      if (byUser.size > 0) {
        const userIds = [...byUser.keys()]
        const tokens = userIds.map((userId) => byUser.get(userId)!.token)
        const platforms = userIds.map((userId) => byUser.get(userId)!.platform)
        // Suppression happens in the same statement as the insert so the count returned is
        // the number of rows that actually exist, not an estimate made before the write.
        const inserted = await client.query(
          `INSERT INTO push_deliveries (campaign_id, user_id, token, platform)
           SELECT $1, u.user_id, u.token, u.platform
           FROM UNNEST($2::text[], $3::text[], $4::text[]) AS u(user_id, token, platform)
           WHERE NOT EXISTS (SELECT 1 FROM push_dead_tokens d WHERE d.token = u.token)`,
          [campaignId, userIds, tokens, platforms]
        )
        valid = inserted.rowCount ?? 0
      }

      await client.query('UPDATE push_campaigns SET audience_count = $1 WHERE id = $2', [valid, campaignId])
      await client.query('COMMIT')

      return { received, valid, duplicates, suppressed: byUser.size - valid }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  // SKIP LOCKED is the whole point: several replicas can run this concurrently and each gets
  // a disjoint set instead of blocking on each other.
  //
  // The claim has to be written into the row, not merely held as a lock. The lock lives only
  // as long as this transaction, and the actual send happens after it commits — so leaving
  // the rows in `pending` would let the next tick hand the same token to another sender and
  // deliver the notification twice, which is the one failure a push system cannot walk back.
  // `claimed_at` is the lease: see reclaimStaleDeliveries for the crash case.
  // A rolling feed is read again long before a trigger leaves it, so on every pass after the
  // first most rows are ones this campaign already holds. ON CONFLICT DO NOTHING is what makes
  // that a no-op: replaceAudience deletes the campaign's deliveries first, which on a feed
  // would return rows that already went out to `pending` and send them a second time.
  async function mergeAudience(campaignId: string, entries: FeedAudienceEntry[]): Promise<FeedAudienceReport> {
    if (entries.length === 0) {
      return { queued: 0, alreadyQueued: 0, suppressed: 0 }
    }

    // The feed's grain is one row per install per trigger, and a campaign is one trigger, so a
    // repeated user_id would mean the warehouse broke its own grain. Collapsing here keeps that
    // from turning into an ON CONFLICT against our own statement.
    const byUser = new Map<string, FeedAudienceEntry>()
    for (const entry of entries) {
      byUser.set(entry.userId, entry)
    }
    const unique = [...byUser.values()]

    const client = await pg.getPool().connect()
    try {
      await client.query('BEGIN')

      const dead = await client.query<{ count: string }>(
        `SELECT COUNT(*) AS count
         FROM UNNEST($1::text[]) AS u(token)
         JOIN push_dead_tokens d ON d.token = u.token`,
        [unique.map((entry) => entry.token)]
      )
      const suppressed = Number(dead.rows[0]?.count ?? 0)

      const inserted = await client.query(
        `INSERT INTO push_deliveries (campaign_id, user_id, token, platform, deep_link, image_url, send_at)
         SELECT $1, u.user_id, u.token, u.platform, u.deep_link, NULLIF(u.image_url, ''), u.send_at::timestamptz
         FROM UNNEST($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[])
              AS u(user_id, token, platform, deep_link, image_url, send_at)
         WHERE NOT EXISTS (SELECT 1 FROM push_dead_tokens d WHERE d.token = u.token)
         ON CONFLICT (campaign_id, user_id) DO NOTHING`,
        [
          campaignId,
          unique.map((entry) => entry.userId),
          unique.map((entry) => entry.token),
          unique.map((entry) => entry.platform),
          unique.map((entry) => entry.deepLink),
          unique.map((entry) => entry.imageUrl ?? ''),
          unique.map((entry) => entry.sendAt)
        ]
      )
      const queued = inserted.rowCount ?? 0

      // Counted from the table rather than from the batch: a recurring campaign's audience is
      // everyone it has ever queued, not everyone this ingest happened to bring.
      await client.query(
        `UPDATE push_campaigns
         SET audience_count = (SELECT COUNT(*) FROM push_deliveries WHERE campaign_id = $1)
         WHERE id = $1`,
        [campaignId]
      )
      await client.query('COMMIT')

      return { queued, alreadyQueued: unique.length - suppressed - queued, suppressed }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async function claimDeliveries(limit: number): Promise<ClaimedDelivery[]> {
    const result = await pg.query<{
      campaign_id: string
      user_id: string
      token: string
      platform: PushPlatform
      campaign_key: string
      title: string
      body: string
      deep_link: string
      image_url: string | null
      category: string
      ttl_seconds: number
      attempts: number
    }>(SQL`
      WITH claimed AS (
        SELECT d.campaign_id, d.user_id
        FROM push_deliveries d
        JOIN push_campaigns c ON c.id = d.campaign_id
        WHERE c.status IN ('scheduled', 'sending')
          AND (c.scheduled_at IS NULL OR c.scheduled_at <= now())
          AND d.state = 'pending'
          -- A feed row carries the instant it is due, in the install's own evening. A row whose
          -- moment already passed is claimed at once, which is what sends a trigger that came
          -- due while nobody was reading the feed instead of dropping it.
          AND (d.send_at IS NULL OR d.send_at <= now())
        -- Ordered by campaign_id, which is UUID order: arbitrary between campaigns but exactly
        -- what push_deliveries_campaign_id_state_index provides, so the batch comes out of the
        -- index with no sort. Ordering by due time instead was measured at 24ms against 0.17ms
        -- on 100k pending rows (seq scan + 6MB external merge sort) because the ordering column
        -- lives on the other table. Fairness between concurrent campaigns needs the campaign
        -- chosen in a separate round trip, not a different ORDER BY.
        ORDER BY d.campaign_id
        LIMIT ${limit}
        FOR UPDATE OF d SKIP LOCKED
      ), taken AS (
        UPDATE push_deliveries d
        SET state = 'sending', claimed_at = now()
        FROM claimed
        WHERE d.campaign_id = claimed.campaign_id AND d.user_id = claimed.user_id
        RETURNING d.campaign_id, d.user_id, d.token, d.platform, d.attempts, d.deep_link, d.image_url
      ), started AS (
        UPDATE push_campaigns c
        SET status = 'sending', started_at = COALESCE(c.started_at, now())
        WHERE c.id IN (SELECT campaign_id FROM taken) AND c.status = 'scheduled'
        RETURNING c.id
      )
      SELECT t.campaign_id, t.user_id, t.token, t.platform, t.attempts,
             c.campaign_key, c.title, c.body, c.category, c.ttl_seconds,
             COALESCE(t.deep_link, c.deep_link) AS deep_link,
             COALESCE(t.image_url, c.image_url) AS image_url
      FROM taken t
      JOIN push_campaigns c ON c.id = t.campaign_id
    `)

    return result.rows.map((row) => ({
      campaignId: row.campaign_id,
      userId: row.user_id,
      token: row.token,
      platform: row.platform,
      campaignKey: row.campaign_key,
      title: row.title,
      body: row.body,
      deepLink: row.deep_link,
      imageUrl: row.image_url,
      category: row.category,
      ttlSeconds: row.ttl_seconds,
      attempts: row.attempts
    }))
  }

  // A replica that dies between claiming and recording leaves rows stuck in `sending`.
  // Past the lease they go back to the queue, but only while there are attempts left:
  // a delivery that keeps killing whatever picks it up is marked failed instead of
  // circulating forever.
  //
  // The expiry itself counts as an attempt. Only a *completed* send used to bump `attempts`,
  // so a row that died before recordOutcomes ran — the exact case this function exists for —
  // came back with its budget untouched and could cycle pending->sending->pending forever.
  // Every SET here reads the pre-UPDATE `attempts`, hence the explicit +1 in both branches.
  async function reclaimStaleDeliveries(leaseSeconds: number, maxAttempts: number): Promise<number> {
    const result = await pg.query(SQL`
      UPDATE push_deliveries
      SET attempts = attempts + 1,
          state = CASE WHEN attempts + 1 >= ${maxAttempts} THEN 'failed' ELSE 'pending' END,
          error_code = CASE WHEN attempts + 1 >= ${maxAttempts} THEN 'LEASE_EXPIRED' ELSE error_code END,
          claimed_at = NULL
      WHERE state = 'sending'
        AND claimed_at < now() - (${leaseSeconds} * INTERVAL '1 second')
    `)
    return result.rowCount ?? 0
  }

  async function recordOutcomes(outcomes: DeliveryOutcome[]): Promise<void> {
    if (outcomes.length === 0) {
      return
    }
    const client = await pg.getPool().connect()
    try {
      await client.query('BEGIN')
      for (const outcome of outcomes) {
        await client.query(
          `UPDATE push_deliveries
           SET state = $3, provider_msg_id = $4, error_code = $5,
               attempts = attempts + 1, claimed_at = NULL,
               -- Only a real send stamps sent_at. A retry goes back to pending, and a
               -- timestamp there would claim it went out when it did not.
               sent_at = CASE WHEN $3 = 'sent' THEN now() ELSE sent_at END
           WHERE campaign_id = $1 AND user_id = $2`,
          [
            outcome.campaignId,
            outcome.userId,
            outcome.state,
            outcome.providerMsgId ?? null,
            outcome.errorCode ?? null
          ]
        )
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async function markTokensDead(tokens: { token: string; errorCode: string }[]): Promise<void> {
    if (tokens.length === 0) {
      return
    }
    await pg.query(
      SQL`INSERT INTO push_dead_tokens (token, error_code)
          SELECT * FROM UNNEST(${tokens.map((t) => t.token)}::text[], ${tokens.map((t) => t.errorCode)}::text[])
          ON CONFLICT (token) DO UPDATE SET error_code = EXCLUDED.error_code, seen_at = now()`
    )
  }

  // A recurring campaign's empty queue means idle, not done. Closing it as `sent` would take
  // it out of the claim's status filter, and the next day's rows would sit in `pending` for
  // good — so it goes back to `scheduled` and the next ingest starts it again.
  async function finishDrainedCampaigns(): Promise<string[]> {
    const result = await pg.query<{ id: string }>(SQL`
      UPDATE push_campaigns SET
        status = CASE WHEN is_recurring THEN 'scheduled' ELSE 'sent' END,
        finished_at = CASE WHEN is_recurring THEN NULL ELSE now() END
      WHERE status = 'sending'
        AND NOT EXISTS (
          SELECT 1 FROM push_deliveries d
          WHERE d.campaign_id = push_campaigns.id AND d.state IN ('pending', 'sending')
        )
      RETURNING id
    `)
    return result.rows.map((row) => row.id)
  }

  async function getStats(campaignId: string): Promise<CampaignStats> {
    const result = await pg.query<{ state: PushDeliveryState; error_code: string | null; count: string }>(SQL`
      SELECT state, error_code, COUNT(*)::text AS count
      FROM push_deliveries
      WHERE campaign_id = ${campaignId}
      GROUP BY state, error_code
    `)

    const stats: CampaignStats = {
      attempted: 0,
      sent: 0,
      failed: 0,
      pending: 0,
      cancelled: 0,
      inFlight: 0,
      errors: {}
    }
    for (const row of result.rows) {
      const count = Number(row.count)
      stats.attempted += count
      if (row.state === 'sent') stats.sent += count
      else if (row.state === 'pending') stats.pending += count
      else if (row.state === 'cancelled') stats.cancelled += count
      else if (row.state === 'sending') stats.inFlight += count
      else if (row.state === 'failed') {
        stats.failed += count
        const code = row.error_code ?? 'UNKNOWN'
        stats.errors[code] = (stats.errors[code] ?? 0) + count
      }
    }
    return stats
  }

  return {
    listCampaigns,
    getCampaign,
    getCampaignByKey,
    createCampaign,
    updateCampaign,
    setStatus,
    approveCampaign,
    cancelCampaign,
    replaceAudience,
    mergeAudience,
    claimDeliveries,
    reclaimStaleDeliveries,
    recordOutcomes,
    markTokensDead,
    finishDrainedCampaigns,
    getStats
  }
}
