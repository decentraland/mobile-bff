import SQL from 'sql-template-strings'
import { AppComponents } from '../types'

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
  createdBy: string
}

export type UpdatePushCampaignInput = {
  title: string
  body: string
  deepLink: string
  imageUrl: string | null
  ttlSeconds: number
  scheduledAt: string | null
}

/** One row of the uploaded audience. */
export type AudienceEntry = { userId: string; token: string }

export type AudienceReport = {
  received: number
  /** Rows written to push_deliveries as `pending`. */
  valid: number
  /** Same user_id appearing more than once in the upload. */
  duplicates: number
  /** Tokens FCM already told us are gone. */
  suppressed: number
}

/** A delivery claimed by the dispatcher, joined with what it needs to send. */
export type ClaimedDelivery = {
  campaignId: string
  userId: string
  token: string
  campaignKey: string
  title: string
  body: string
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
  createCampaign(input: CreatePushCampaignInput): Promise<PushCampaign>
  updateCampaign(id: string, changes: UpdatePushCampaignInput): Promise<PushCampaign | null>
  /** Moves a campaign between states, refusing transitions that are not allowed. */
  setStatus(id: string, from: PushCampaignStatus[], to: PushCampaignStatus): Promise<PushCampaign | null>
  approveCampaign(id: string, approvedBy: string): Promise<PushCampaign | null>
  cancelCampaign(id: string): Promise<{ campaign: PushCampaign; cancelledDeliveries: number } | null>
  replaceAudience(campaignId: string, entries: AudienceEntry[]): Promise<AudienceReport>
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
  scheduled_at, audience_count, created_by, approved_by, approved_at, created_at,
  started_at, finished_at
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

  async function createCampaign(input: CreatePushCampaignInput): Promise<PushCampaign> {
    const query = SQL`
      INSERT INTO push_campaigns (campaign_key, title, body, deep_link, image_url, ttl_seconds, scheduled_at, created_by)
      VALUES (${input.campaignKey}, ${input.title}, ${input.body}, ${input.deepLink}, ${input.imageUrl},
              ${input.ttlSeconds}, ${input.scheduledAt}, ${input.createdBy})
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
        scheduled_at = ${changes.scheduledAt}
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
    const query = SQL`
      UPDATE push_campaigns
      SET status = 'scheduled', approved_by = ${approvedBy}, approved_at = now()
      WHERE id = ${id} AND status = 'pending_approval' AND created_by <> ${approvedBy}
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

    const byUser = new Map<string, string>()
    for (const entry of entries) {
      byUser.set(entry.userId, entry.token)
    }
    const duplicates = received - byUser.size

    const client = await pg.getPool().connect()
    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM push_deliveries WHERE campaign_id = $1', [campaignId])

      let valid = 0
      if (byUser.size > 0) {
        const userIds = [...byUser.keys()]
        const tokens = userIds.map((userId) => byUser.get(userId) as string)
        // Suppression happens in the same statement as the insert so the count returned is
        // the number of rows that actually exist, not an estimate made before the write.
        const inserted = await client.query(
          `INSERT INTO push_deliveries (campaign_id, user_id, token)
           SELECT $1, u.user_id, u.token
           FROM UNNEST($2::text[], $3::text[]) AS u(user_id, token)
           WHERE NOT EXISTS (SELECT 1 FROM push_dead_tokens d WHERE d.token = u.token)`,
          [campaignId, userIds, tokens]
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
  async function claimDeliveries(limit: number): Promise<ClaimedDelivery[]> {
    const result = await pg.query<{
      campaign_id: string
      user_id: string
      token: string
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
        ORDER BY d.campaign_id
        LIMIT ${limit}
        FOR UPDATE OF d SKIP LOCKED
      ), taken AS (
        UPDATE push_deliveries d
        SET state = 'sending', claimed_at = now()
        FROM claimed
        WHERE d.campaign_id = claimed.campaign_id AND d.user_id = claimed.user_id
        RETURNING d.campaign_id, d.user_id, d.token, d.attempts
      ), started AS (
        UPDATE push_campaigns c
        SET status = 'sending', started_at = COALESCE(c.started_at, now())
        WHERE c.id IN (SELECT campaign_id FROM taken) AND c.status = 'scheduled'
        RETURNING c.id
      )
      SELECT t.campaign_id, t.user_id, t.token, t.attempts,
             c.campaign_key, c.title, c.body, c.deep_link, c.image_url, c.category, c.ttl_seconds
      FROM taken t
      JOIN push_campaigns c ON c.id = t.campaign_id
    `)

    return result.rows.map((row) => ({
      campaignId: row.campaign_id,
      userId: row.user_id,
      token: row.token,
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
  async function reclaimStaleDeliveries(leaseSeconds: number, maxAttempts: number): Promise<number> {
    const result = await pg.query(SQL`
      UPDATE push_deliveries
      SET state = CASE WHEN attempts >= ${maxAttempts} THEN 'failed' ELSE 'pending' END,
          error_code = CASE WHEN attempts >= ${maxAttempts} THEN 'LEASE_EXPIRED' ELSE error_code END,
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

  async function finishDrainedCampaigns(): Promise<string[]> {
    const result = await pg.query<{ id: string }>(SQL`
      UPDATE push_campaigns SET status = 'sent', finished_at = now()
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
    createCampaign,
    updateCampaign,
    setStatus,
    approveCampaign,
    cancelCampaign,
    replaceAudience,
    claimDeliveries,
    reclaimStaleDeliveries,
    recordOutcomes,
    markTokensDead,
    finishDrainedCampaigns,
    getStats
  }
}
