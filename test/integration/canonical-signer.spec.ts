import { Authenticator } from '@dcl/crypto'
import { AUTH_METADATA_HEADER } from '@dcl/crypto'
import { test } from '../components'
import { getAuthHeaders, getIdentity, Identity } from '../utils/signed-fetch'

const PATH = '/deletion'
const SIGNED_METADATA = { signer: 'decentraland-kernel-scene', origin: 'https://play.decentraland.org' }

test('canonical signer', function ({ components }) {
  let identity: Identity

  beforeAll(async () => {
    identity = await getIdentity()
  })

  function signedHeaders(metadata: Record<string, unknown>) {
    return getAuthHeaders('GET', PATH, metadata, (payload) =>
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

  it('drops a re-cased signer to unauthenticated while the canonical spelling still authenticates', async () => {
    const { localFetch } = components

    // The signed-fetch payload is lowercased before signing, so metadata differing only in
    // case shares one signature. Overwriting the header after signing leaves the request
    // genuinely authentic while reading differently to a case-sensitive comparison. This is
    // the attack itself, not a mock of it -- nothing here weakens the signature.
    const headers = signedHeaders(SIGNED_METADATA)
    headers[AUTH_METADATA_HEADER] = JSON.stringify({
      ...SIGNED_METADATA,
      signer: 'Decentraland-Kernel-Scene'
    })

    const rejected = await localFetch.fetch(PATH, { method: 'GET', headers })

    // The router mounts the middleware with `optional: true`, which swallows verification
    // errors instead of answering with them. The guard's 400 therefore never reaches the
    // client: it strips `context.verification`, and the handler's own `!userAddress` check
    // answers 401. Asserting 400 here would never pass, on any version.
    expect(rejected.status).toBe(401)
    await expect(rejected.json()).resolves.toEqual({ ok: false, error: 'Unauthorized' })

    // Positive control, signed by the same helper: the canonical spelling authenticates and
    // reaches the handler, which reports no pending deletion for this fresh identity. If the
    // signing were broken this would also be 401, which is what rules out the case above
    // passing for the wrong reason.
    const accepted = await localFetch.fetch(PATH, { method: 'GET', headers: signedHeaders(SIGNED_METADATA) })

    expect(accepted.status).toBe(200)
    await expect(accepted.json()).resolves.toEqual({ ok: true, data: null })
  })
})
