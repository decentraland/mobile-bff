import { AUTH_METADATA_HEADER, AuthChain, Authenticator } from '@dcl/crypto'
import { test } from '../components'
import { getAuthHeaders, getIdentity, getLegacyAuthHeaders, Identity } from '../utils/signed-fetch'

const PATH = '/deletion'
const CANONICAL_SIGNER = 'decentraland-kernel-scene'

test('canonical signer', function ({ components }) {
  let identity: Identity
  let sign: (payload: string) => AuthChain

  beforeEach(async () => {
    identity = await getIdentity()
    sign = (payload: string) =>
      Authenticator.signPayload(
        {
          ephemeralIdentity: identity.ephemeralIdentity,
          expiration: new Date(Date.now() + 60 * 1000),
          authChain: identity.authChain.authChain
        },
        payload
      )
  })

  describe('when the request is signed with the current payload', () => {
    let headers: Record<string, string>

    beforeEach(() => {
      headers = getAuthHeaders('GET', PATH, { signer: CANONICAL_SIGNER }, sign)
    })

    it('should serve the request when the metadata arrives as it was signed', async () => {
      const response = await components.localFetch.fetch(PATH, { method: 'GET', headers })

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ ok: true, data: null })
    })

    describe('and the signer key is re-cased after signing', () => {
      beforeEach(() => {
        // The attack itself, not a mock of it: nothing here weakens the signature, only the
        // delivered header is rewritten. Under the folded payload this kept a genuinely valid
        // signature while reading as absent to a case-sensitive comparison. The metadata bytes are
        // now inside the signature, so it no longer does.
        headers[AUTH_METADATA_HEADER] = JSON.stringify({ Signer: CANONICAL_SIGNER })
      })

      it('should drop the request to unauthenticated', async () => {
        const response = await components.localFetch.fetch(PATH, { method: 'GET', headers })

        // The router mounts the middleware with `optional: true`, which swallows verification
        // errors rather than answering with them: it strips `context.verification` and the
        // handler's own `!userAddress` check answers. Asserting 400 would never pass here.
        expect(response.status).toBe(401)
        await expect(response.json()).resolves.toEqual({ ok: false, error: 'Unauthorized' })
      })
    })
  })

  // Both signed-fetch consumers still sign the pre-6.0.0 folded payload: godot-explorer
  // (`format!("{}:{}:{}:{}", ...).to_lowercase()` in lib/src/auth/wallet.rs) and mobile-hub
  // (`payloadParts.join(':').toLowerCase()` in src/utils/fetch.ts). These two cases pin why that
  // is compatible here and exactly where the compatibility stops, since this service deliberately
  // does not set `canonicalMetadataKeys`.
  describe('when the request is signed with the pre-6.0.0 folded payload', () => {
    describe('and the metadata is what the shipped client sends', () => {
      let headers: Record<string, string>

      beforeEach(() => {
        // `async_signed_fetch` signs "{}" for a bodyless request, and all three /deletion calls
        // are bodyless.
        headers = getLegacyAuthHeaders('GET', PATH, {}, sign)
      })

      it('should serve the request, the fold being a no-op on metadata with no uppercase', async () => {
        const response = await components.localFetch.fetch(PATH, { method: 'GET', headers })

        expect(response.status).toBe(200)
        await expect(response.json()).resolves.toEqual({ ok: true, data: null })
      })
    })

    describe('and the metadata contains uppercase', () => {
      let headers: Record<string, string>

      beforeEach(() => {
        headers = getLegacyAuthHeaders('GET', PATH, { origin: 'https://play.decentraland.org/Mobile' }, sign)
      })

      it('should refuse the request, the two payload formats no longer agreeing', async () => {
        const response = await components.localFetch.fetch(PATH, { method: 'GET', headers })

        // Not a regression -- no caller sends this today. It is asserted so that a caller which
        // starts signing uppercase metadata before shipping the new payload format shows up as a
        // failing test here rather than as 401s in production. `canonicalMetadataKeys` is the fix
        // if that happens.
        expect(response.status).toBe(401)
        await expect(response.json()).resolves.toEqual({ ok: false, error: 'Unauthorized' })
      })
    })
  })
})
