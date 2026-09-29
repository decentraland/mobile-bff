import { Authenticator } from '@dcl/crypto'
import { test } from '../components'
import { getAuthHeaders, getIdentity, Identity } from '../utils/signed-fetch'

test('device support endpoints', function ({ components }) {
  it('GET /device-support?soc=MT6765 responds with the seeded decision', async () => {
    const { localFetch } = components

    const r = await localFetch.fetch('/device-support?soc=MT6765')

    expect(r.status).toEqual(200)
    const body = await r.json()
    expect(body).toEqual({ ok: true, data: { soc: 'MT6765', decision: 'exclude' } })
  })

  it("GET /device-support?soc=<unknown> responds with 'keep'", async () => {
    const { localFetch } = components

    const r = await localFetch.fetch('/device-support?soc=SM8750')

    expect(r.status).toEqual(200)
    const body = await r.json()
    expect(body).toEqual({ ok: true, data: { soc: 'SM8750', decision: 'keep' } })
  })

  it('GET /device-support without a soc param responds 400', async () => {
    const { localFetch } = components

    const r = await localFetch.fetch('/device-support')

    expect(r.status).toEqual(400)
  })

  it.each([
    ['GET', '/backoffice/device-support', undefined],
    ['PUT', '/backoffice/device-support', { entries: [] }],
    ['PUT', '/backoffice/device-support/MT6765', { decision: 'exclude' }],
    ['DELETE', '/backoffice/device-support/MT6765', undefined]
  ])('%s %s without a signed fetch responds 401', async (method, path, body) => {
    const { localFetch } = components

    const r = await localFetch.fetch(path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    })

    expect(r.status).toEqual(401)
  })
})

test('backoffice device support endpoints with signed fetch', function ({ components }) {
  let identity: Identity
  let originalAllowedUsers: string | undefined

  beforeAll(async () => {
    identity = await getIdentity()
    originalAllowedUsers = process.env.ALLOWED_USERS
    process.env.ALLOWED_USERS = identity.realAccount.address
  })

  afterAll(async () => {
    // Leave the shared mobile_test database in its seeded state for other suites
    await components.pg.query(`DELETE FROM device_soc_support WHERE updated_by IS NOT NULL`)
    if (originalAllowedUsers === undefined) {
      delete process.env.ALLOWED_USERS
    } else {
      process.env.ALLOWED_USERS = originalAllowedUsers
    }
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

  it('lists the entries for an allowed user', async () => {
    const response = await makeSignedRequest(identity, 'GET', '/backoffice/device-support')
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data.entries.length).toBeGreaterThanOrEqual(320)
  })

  it('upserts, exposes it publicly, updates it, then deletes it', async () => {
    // Create
    const createResponse = await makeSignedRequest(
      identity, 'PUT', '/backoffice/device-support/integration-test-soc', { decision: 'exclude' }
    )
    const created = await createResponse.json()

    expect(createResponse.status).toBe(200)
    expect(created.data).toMatchObject({ soc: 'INTEGRATION-TEST-SOC', decision: 'exclude' })

    // Publicly visible
    const publicResponse = await components.localFetch.fetch('/device-support?soc=integration-test-soc')
    expect((await publicResponse.json()).data.decision).toBe('exclude')

    // Update
    const updateResponse = await makeSignedRequest(
      identity, 'PUT', '/backoffice/device-support/integration-test-soc', { decision: 'below-minspec' }
    )
    expect((await updateResponse.json()).data.decision).toBe('below-minspec')

    // Delete -> reverts to 'keep'
    const deleteResponse = await makeSignedRequest(identity, 'DELETE', '/backoffice/device-support/integration-test-soc')
    expect(deleteResponse.status).toBe(200)

    const afterDelete = await components.localFetch.fetch('/device-support?soc=integration-test-soc')
    expect((await afterDelete.json()).data.decision).toBe('keep')
  })

  it('bulk-upserts multiple entries in one call', async () => {
    const response = await makeSignedRequest(identity, 'PUT', '/backoffice/device-support', {
      entries: [
        { soc: 'integration-bulk-1', decision: 'exclude' },
        { soc: 'integration-bulk-2', decision: 'below-minspec' }
      ]
    })

    expect(response.status).toBe(200)
    expect((await response.json()).data.count).toBe(2)

    const check1 = await components.localFetch.fetch('/device-support?soc=integration-bulk-1')
    expect((await check1.json()).data.decision).toBe('exclude')
  })

  it('rejects an invalid decision with 400', async () => {
    const response = await makeSignedRequest(
      identity, 'PUT', '/backoffice/device-support/bad-entry', { decision: 'nope' }
    )

    expect(response.status).toBe(400)
  })

  it('responds 404 when deleting a missing entry', async () => {
    const response = await makeSignedRequest(identity, 'DELETE', '/backoffice/device-support/does-not-exist')

    expect(response.status).toBe(404)
  })

  it('responds 403 when signed by a user not in ALLOWED_USERS', async () => {
    const otherIdentity = await getIdentity()

    const response = await makeSignedRequest(
      otherIdentity, 'PUT', '/backoffice/device-support/MT6765', { decision: 'exclude' }
    )

    expect(response.status).toBe(403)
  })
})
