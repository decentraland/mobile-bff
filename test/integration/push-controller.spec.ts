import { Authenticator } from '@dcl/crypto'
import { test } from '../components'
import { getAuthHeaders, getIdentity, Identity } from '../utils/signed-fetch'

// Exercises the endpoints as a person actually drives them: create, upload, submit, approve.
// The states only mean anything in sequence, so this is one walk through the flow plus the
// refusals that are easy to regress — the two-man rule and editing after submission.

test('push backoffice endpoints', function ({ components }) {
  it.each([
    ['GET', '/backoffice/push/campaigns'],
    ['POST', '/backoffice/push/campaigns'],
    ['POST', '/backoffice/push/campaigns/00000000-0000-0000-0000-000000000000/approve'],
    ['GET', '/backoffice/push/campaigns/00000000-0000-0000-0000-000000000000/stats']
  ])('%s %s without a signed fetch responds 401', async (method, path) => {
    const { localFetch } = components

    const r = await localFetch.fetch(path, { method })

    expect(r.status).toEqual(401)
  })
})

test('push backoffice endpoints with signed fetch', function ({ components }) {
  let creator: Identity
  let approver: Identity
  let outsider: Identity

  function authHeaders(identity: Identity, method: string, path: string) {
    return getAuthHeaders(method, path, {}, (payload) =>
      Authenticator.signPayload(
        {
          ephemeralIdentity: identity.ephemeralIdentity,
          expiration: new Date(Date.now() + 60 * 1000),
          authChain: identity.authChain.authChain
        },
        payload
      )
    )
  }

  function signed(identity: Identity, method: string, path: string, body?: any) {
    return components.localFetch.fetch(path, {
      method,
      headers: {
        ...authHeaders(identity, method, path),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    })
  }

  /** The audience is uploaded as raw CSV, not JSON, so it needs its own request. */
  function signedCsv(identity: Identity, path: string, csv: string) {
    return components.localFetch.fetch(path, {
      method: 'POST',
      headers: { ...authHeaders(identity, 'POST', path), 'content-type': 'text/csv' },
      body: csv
    })
  }

  const draft = {
    campaignKey: 'controller-spec',
    title: 'Come back',
    body: 'Something is happening in Genesis Plaza',
    deepLink: 'decentraland://open?position=0,0'
  }

  beforeAll(async () => {
    creator = await getIdentity()
    approver = await getIdentity()
    outsider = await getIdentity()
    process.env.ALLOWED_USERS = `${creator.realAccount.address},${approver.realAccount.address}`
  })

  afterEach(async () => {
    // Leave the shared mobile_test database clean for other suites
    await components.pg.query("DELETE FROM push_campaigns WHERE campaign_key = 'controller-spec'")
  })

  it('walks a campaign from draft to approved, refusing every shortcut', async () => {
    const created = await signed(creator, 'POST', '/backoffice/push/campaigns', draft)
    expect(created.status).toEqual(201)
    const { data: campaign } = await created.json()
    expect(campaign.status).toEqual('draft')
    expect(campaign.ttlSeconds).toEqual(86400)
    expect(campaign.createdBy).toEqual(creator.realAccount.address.toLowerCase())

    const base = `/backoffice/push/campaigns/${campaign.id}`

    // Nothing to send yet: approving now would schedule a campaign that reaches nobody.
    const earlySubmit = await signed(creator, 'POST', `${base}/submit`)
    expect(earlySubmit.status).toEqual(409)
    expect((await earlySubmit.json()).error).toMatch(/audience/i)

    const csv = ['user_id,fcm_token', `user-a,${'a'.repeat(40)}`, `user-b,${'b'.repeat(40)}`, ''].join('\n')
    const audience = await signedCsv(creator, `${base}/audience`, csv)
    expect(audience.status).toEqual(200)
    expect((await audience.json()).data).toMatchObject({ valid: 2, duplicates: 0, suppressed: 0, invalid: [] })

    const submitted = await signed(creator, 'POST', `${base}/submit`)
    expect(submitted.status).toEqual(200)
    expect((await submitted.json()).data.status).toEqual('pending_approval')

    // Content is frozen once somebody is being asked to vouch for it.
    const lateEdit = await signed(creator, 'PUT', base, { ...draft, title: 'Different words' })
    expect(lateEdit.status).toEqual(409)

    // The two-man rule, which is the whole point of the approval step.
    const selfApprove = await signed(creator, 'POST', `${base}/approve`)
    expect(selfApprove.status).toEqual(403)
    expect((await selfApprove.json()).error).toMatch(/other than its creator/i)

    // And it is a rule about people, not about being signed in: an address outside
    // ALLOWED_USERS is refused before the rule is even considered.
    const strangerApprove = await signed(outsider, 'POST', `${base}/approve`)
    expect(strangerApprove.status).toEqual(403)

    const approved = await signed(approver, 'POST', `${base}/approve`)
    expect(approved.status).toEqual(200)
    const approvedBody = await approved.json()
    expect(approvedBody.data.status).toEqual('scheduled')
    expect(approvedBody.data.approvedBy).toEqual(approver.realAccount.address.toLowerCase())

    const stats = await signed(creator, 'GET', `${base}/stats`)
    expect(stats.status).toEqual(200)
    expect((await stats.json()).data.stats).toMatchObject({ attempted: 2, pending: 2, sent: 0 })

    // Kill switch reaches everything still queued.
    const cancelled = await signed(approver, 'POST', `${base}/cancel`)
    expect(cancelled.status).toEqual(200)
    expect((await cancelled.json()).data).toMatchObject({ cancelledDeliveries: 2 })
  })

  it('refuses content that would break attribution or the tray', async () => {
    // The sender appends these; a link carrying them would end up with the param twice.
    const duplicated = await signed(creator, 'POST', '/backoffice/push/campaigns', {
      ...draft,
      deepLink: 'decentraland://open?position=0,0&push_campaign_id=manual'
    })
    expect(duplicated.status).toEqual(400)
    expect((await duplicated.json()).error).toMatch(/push_campaign_id/)

    // `c=` is install attribution; a push carrying one would overwrite where a user came from.
    const adToken = await signed(creator, 'POST', '/backoffice/push/campaigns', {
      ...draft,
      deepLink: 'decentraland://open?c=summer-26'
    })
    expect(adToken.status).toEqual(400)

    const httpLink = await signed(creator, 'POST', '/backoffice/push/campaigns', {
      ...draft,
      deepLink: 'https://decentraland.org'
    })
    expect(httpLink.status).toEqual(400)

    // Over four weeks FCM silently clamps, so storing it would be a lie.
    const longTtl = await signed(creator, 'POST', '/backoffice/push/campaigns', { ...draft, ttlSeconds: 2419201 })
    expect(longTtl.status).toEqual(400)

    // Long copy is a warning, not a refusal: it still delivers.
    const wordy = await signed(creator, 'POST', '/backoffice/push/campaigns', { ...draft, title: 'x'.repeat(100) })
    expect(wordy.status).toEqual(201)
    expect((await wordy.json()).warnings[0]).toMatch(/truncates/)
  })
})
