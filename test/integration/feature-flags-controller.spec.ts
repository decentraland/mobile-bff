import { Authenticator } from '@dcl/crypto'
import { test } from '../components'
import { getAuthHeaders, getIdentity, Identity } from '../utils/signed-fetch'

test('feature flags endpoints', function ({ components }) {
  it('GET /feature-flags responds with the flags map', async () => {
    const { localFetch } = components

    const r = await localFetch.fetch('/feature-flags')

    expect(r.status).toEqual(200)
    const body = await r.json()
    expect(body.ok).toBe(true)
    // Values are runtime-mutable (other suites share the test db), so assert shape not values
    expect(body.data.flags).toEqual({
      pulse: expect.any(Boolean),
      'dual-channel': expect.any(Boolean)
    })
  })

  it('PUT /backoffice/feature-flags without a signed fetch responds 401', async () => {
    const { localFetch } = components

    const r = await localFetch.fetch('/backoffice/feature-flags', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ flags: { pulse: true } })
    })

    expect(r.status).toEqual(401)
  })
})

test('backoffice feature flags endpoints with signed fetch', function ({ components }) {
  let identity: Identity

  beforeAll(async () => {
    identity = await getIdentity()
    process.env.ALLOWED_USERS = identity.realAccount.address
  })

  afterAll(async () => {
    // Leave the shared mobile_test database in its seeded state for other suites
    await components.pg.query("UPDATE feature_flags SET enabled = false, updated_by = NULL WHERE name = 'pulse'")
    await components.pg.query("UPDATE feature_flags SET enabled = true, updated_by = NULL WHERE name = 'dual-channel'")
  })

  function makeSignedRequest(signer: Identity, method: string, path: string, body?: any) {
    const { localFetch } = components
    const headers: Record<string, string> = {
      ...getAuthHeaders(method, path, { origin: 'https://play.decentraland.org' }, (payload) =>
        Authenticator.signPayload(
          {
            ephemeralIdentity: signer.ephemeralIdentity,
            expiration: new Date(Date.now() + 60 * 1000),
            authChain: signer.authChain.authChain
          },
          payload
        )
      )
    }
    if (body) {
      headers['Content-Type'] = 'application/json'
    }
    return localFetch.fetch(path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    })
  }

  it('updates a flag and returns the full map when signed by an allowed user', async () => {
    const response = await makeSignedRequest(identity, 'PUT', '/backoffice/feature-flags', {
      flags: { pulse: true }
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data.flags.pulse).toBe(true)
    expect(body.data.flags).toHaveProperty('dual-channel')

    const persisted = await components.pg.query("SELECT enabled, updated_by FROM feature_flags WHERE name = 'pulse'")
    expect(persisted.rows[0].enabled).toBe(true)
    expect(persisted.rows[0].updated_by.toLowerCase()).toBe(identity.realAccount.address.toLowerCase())
  })

  it('responds 403 when signed by a user not in ALLOWED_USERS', async () => {
    const otherIdentity = await getIdentity()

    const response = await makeSignedRequest(otherIdentity, 'PUT', '/backoffice/feature-flags', {
      flags: { pulse: false }
    })

    expect(response.status).toBe(403)
  })

  it('responds 400 for an unknown flag name', async () => {
    const response = await makeSignedRequest(identity, 'PUT', '/backoffice/feature-flags', {
      flags: { 'not-a-flag': true }
    })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ ok: false, error: "Unknown feature flag: 'not-a-flag'" })
  })
})
