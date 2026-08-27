import { AUTH_METADATA_HEADER, AuthChain, Authenticator } from '@dcl/crypto'
import { test } from '../components'
import { getAuthHeaders, getIdentity, getLegacyAuthHeaders, Identity } from '../utils/signed-fetch'

const PATH = '/deletion'
const CANONICAL_SIGNER = 'decentraland-kernel-scene'

// Uppercase in a field the service does not guard. The two payload formats only diverge where the
// metadata has uppercase, so without it a legacy-signed request is byte-identical to a current one
// and would verify on the current path -- proving nothing about the fallback.
const LEGACY_METADATA = { signer: CANONICAL_SIGNER, origin: 'https://play.decentraland.org/Mobile' }
const CURRENT_METADATA = { signer: CANONICAL_SIGNER, origin: 'https://play.decentraland.org' }

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
      headers = getAuthHeaders('GET', PATH, CURRENT_METADATA, sign)
    })

    it('should serve the request when the metadata arrives as it was signed', async () => {
      const response = await components.localFetch.fetch(PATH, { method: 'GET', headers })

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ ok: true, data: null })
    })

    describe('and the signer key is re-cased after signing', () => {
      beforeEach(() => {
        // The attack itself, not a mock of it: nothing here weakens the signature, only the
        // delivered header is rewritten. Before 6.0.0 the payload was folded before signing, so
        // this kept a genuinely valid signature while reading as absent to a case-sensitive
        // comparison. The metadata bytes are now inside the signature, so it no longer does.
        headers[AUTH_METADATA_HEADER] = JSON.stringify({ ...CURRENT_METADATA, Signer: CANONICAL_SIGNER })
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

  describe('when the request is signed with the pre-6.0.0 payload', () => {
    let headers: Record<string, string>

    beforeEach(() => {
      headers = getLegacyAuthHeaders('GET', PATH, LEGACY_METADATA, sign)
    })

    it('should still serve the request so already-shipped mobile clients keep working', async () => {
      const response = await components.localFetch.fetch(PATH, { method: 'GET', headers })

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ ok: true, data: null })
    })

    describe('and the signer key is re-cased after signing', () => {
      beforeEach(() => {
        // Written out rather than spread so the key order matches what was signed and only the
        // casing differs. Spreading `signer: undefined` would drop the key and re-append it last,
        // changing the bytes -- the folded payload would then differ too and the signature would
        // fail on its own, which is not the case under test.
        headers[AUTH_METADATA_HEADER] = JSON.stringify({
          Signer: CANONICAL_SIGNER,
          origin: LEGACY_METADATA.origin
        })
      })

      it('should refuse the request rather than accept a spelling the signature never pinned', async () => {
        const response = await components.localFetch.fetch(PATH, { method: 'GET', headers })

        // This is the case that makes `canonicalMetadataKeys` worth declaring. The legacy payload
        // folds the metadata, so the re-cased header still produces the exact bytes that were
        // signed: the fallback would verify it and serve a 200. It is refused because `Signer`
        // folds to a declared key without matching its spelling -- not because the signature is
        // bad, which it is not.
        expect(response.status).toBe(401)
        await expect(response.json()).resolves.toEqual({ ok: false, error: 'Unauthorized' })
      })
    })
  })
})
