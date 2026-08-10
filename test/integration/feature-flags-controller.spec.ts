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
    expect(body.data.flags).toMatchObject({
      pulse: expect.any(Boolean),
      'dual-channel': expect.any(Boolean),
      'sentry-sample-rate': expect.any(Number),
      'sentry-traces-sample-rate': expect.any(Number)
    })
  })

  it.each([
    ['GET', '/backoffice/feature-flags', undefined],
    ['POST', '/backoffice/feature-flags', { name: 'x-flag' }],
    ['PUT', '/backoffice/feature-flags/pulse', { enabled: true }],
    ['DELETE', '/backoffice/feature-flags/pulse', undefined]
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

test('backoffice feature flags endpoints with signed fetch', function ({ components }) {
  let identity: Identity

  beforeAll(async () => {
    identity = await getIdentity()
    process.env.ALLOWED_USERS = identity.realAccount.address
  })

  afterAll(async () => {
    // Leave the shared mobile_test database in its seeded state for other suites
    await components.pg.query(`
      DELETE FROM feature_flags
      WHERE name NOT IN ('pulse', 'dual-channel', 'sentry-sample-rate', 'sentry-traces-sample-rate')
    `)
    await components.pg.query("UPDATE feature_flags SET enabled = false, updated_by = NULL WHERE name = 'pulse'")
    await components.pg.query("UPDATE feature_flags SET enabled = true, updated_by = NULL WHERE name = 'dual-channel'")
    await components.pg.query("UPDATE feature_flags SET value = '1', updated_by = NULL WHERE name = 'sentry-sample-rate'")
    await components.pg.query("UPDATE feature_flags SET value = '0.1', updated_by = NULL WHERE name = 'sentry-traces-sample-rate'")
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

  it('lists the flags with details for an allowed user', async () => {
    const response = await makeSignedRequest(identity, 'GET', '/backoffice/feature-flags')
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    const names = body.data.flags.map((f: { name: string }) => f.name)
    expect(names).toEqual(expect.arrayContaining(['pulse', 'dual-channel']))
    expect(body.data.flags[0]).toHaveProperty('description')
    expect(body.data.flags[0]).toHaveProperty('updatedAt')
  })

  it('creates a flag, exposes it publicly, updates it and deletes it', async () => {
    // Create
    const createResponse = await makeSignedRequest(identity, 'POST', '/backoffice/feature-flags', {
      name: 'integration-test-flag',
      description: 'Created by the integration suite'
    })
    const created = await createResponse.json()

    expect(createResponse.status).toBe(201)
    expect(created.data).toMatchObject({
      name: 'integration-test-flag',
      enabled: false,
      description: 'Created by the integration suite'
    })
    expect(created.data.updatedBy.toLowerCase()).toBe(identity.realAccount.address.toLowerCase())

    // Publicly visible
    const publicResponse = await components.localFetch.fetch('/feature-flags')
    const publicBody = await publicResponse.json()
    expect(publicBody.data.flags['integration-test-flag']).toBe(false)

    // Update enabled
    const updateResponse = await makeSignedRequest(
      identity, 'PUT', '/backoffice/feature-flags/integration-test-flag', { enabled: true }
    )
    const updated = await updateResponse.json()
    expect(updateResponse.status).toBe(200)
    expect(updated.data.enabled).toBe(true)

    // Update description
    const descResponse = await makeSignedRequest(
      identity, 'PUT', '/backoffice/feature-flags/integration-test-flag', { description: 'Edited' }
    )
    expect((await descResponse.json()).data.description).toBe('Edited')

    // Delete
    const deleteResponse = await makeSignedRequest(
      identity, 'DELETE', '/backoffice/feature-flags/integration-test-flag'
    )
    expect(deleteResponse.status).toBe(200)

    const afterDelete = await components.localFetch.fetch('/feature-flags')
    expect((await afterDelete.json()).data.flags).not.toHaveProperty('integration-test-flag')
  })

  it('creates a number flag from a textfield string, updates it and exposes it as a number', async () => {
    // Create — backoffice textfields submit strings; the API canonicalizes them
    const createResponse = await makeSignedRequest(identity, 'POST', '/backoffice/feature-flags', {
      name: 'integration-number-flag',
      type: 'number',
      value: '0.10'
    })
    const created = await createResponse.json()

    expect(createResponse.status).toBe(201)
    expect(created.data).toMatchObject({ name: 'integration-number-flag', type: 'number', value: 0.1 })

    // Publicly visible as a number
    const publicResponse = await components.localFetch.fetch('/feature-flags')
    const publicBody = await publicResponse.json()
    expect(publicBody.data.flags['integration-number-flag']).toBe(0.1)

    // Update the value
    const updateResponse = await makeSignedRequest(
      identity, 'PUT', '/backoffice/feature-flags/integration-number-flag', { value: 1 }
    )
    const updated = await updateResponse.json()
    expect(updateResponse.status).toBe(200)
    expect(updated.data.value).toBe(1)

    // Toggling enabled on a number flag is rejected
    const enabledResponse = await makeSignedRequest(
      identity, 'PUT', '/backoffice/feature-flags/integration-number-flag', { enabled: true }
    )
    expect(enabledResponse.status).toBe(400)

    // Delete
    const deleteResponse = await makeSignedRequest(
      identity, 'DELETE', '/backoffice/feature-flags/integration-number-flag'
    )
    expect(deleteResponse.status).toBe(200)
  })

  it('rejects a non-numeric value for a number flag with 400', async () => {
    const response = await makeSignedRequest(identity, 'POST', '/backoffice/feature-flags', {
      name: 'bad-number-flag',
      type: 'number',
      value: 'lots'
    })

    expect(response.status).toBe(400)
  })

  it('rejects a duplicate flag name with 409', async () => {
    const response = await makeSignedRequest(identity, 'POST', '/backoffice/feature-flags', { name: 'pulse' })

    expect(response.status).toBe(409)
  })

  it('rejects an invalid flag name with 400', async () => {
    const response = await makeSignedRequest(identity, 'POST', '/backoffice/feature-flags', { name: 'Not Valid' })

    expect(response.status).toBe(400)
  })

  it('responds 404 when updating a missing flag', async () => {
    const response = await makeSignedRequest(
      identity, 'PUT', '/backoffice/feature-flags/does-not-exist', { enabled: true }
    )

    expect(response.status).toBe(404)
  })

  it('responds 403 when signed by a user not in ALLOWED_USERS', async () => {
    const otherIdentity = await getIdentity()

    const response = await makeSignedRequest(otherIdentity, 'PUT', '/backoffice/feature-flags/pulse', {
      enabled: false
    })

    expect(response.status).toBe(403)
  })
})
