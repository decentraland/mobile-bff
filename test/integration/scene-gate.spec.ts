import { AuthChain, Authenticator } from '@dcl/crypto'
import { test } from '../components'
import { getAuthHeaders, getIdentity, Identity } from '../utils/signed-fetch'

const PATH = '/deletion'
const SCENE_SIGNER = 'decentraland-kernel-scene'

test('scene gate', function ({ components }) {
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

  // Every signature below is valid -- a scene signs with the player's identity. What is under test
  // is whether the service acts on that identity for a caller declaring itself a scene.
  describe('when the caller declares itself a scene', () => {
    let headers: Record<string, string>

    beforeEach(() => {
      headers = getAuthHeaders('GET', PATH, { signer: SCENE_SIGNER }, sign)
    })

    it('should refuse to act on the visiting user identity', async () => {
      const response = await components.localFetch.fetch(PATH, { method: 'GET', headers })

      // `optional: true` swallows the validator's 400, so the handler's `!userAddress` check
      // answers. Without the gate this is served a 200.
      expect(response.status).toBe(401)
      await expect(response.json()).resolves.toEqual({ ok: false, error: 'Unauthorized' })
    })

    describe('and the signer value is re-cased', () => {
      beforeEach(() => {
        headers = getAuthHeaders('GET', PATH, { signer: 'Decentraland-Kernel-Scene' }, sign)
      })

      it('should refuse it rather than compare it and read it as something else', async () => {
        const response = await components.localFetch.fetch(PATH, { method: 'GET', headers })

        expect(response.status).toBe(401)
      })
    })

    describe('and the signer is delivered under a key that only case-folds to signer', () => {
      beforeEach(() => {
        headers = getAuthHeaders('GET', PATH, { Signer: SCENE_SIGNER }, sign)
      })

      it('should refuse it rather than read the gated field as absent', async () => {
        const response = await components.localFetch.fetch(PATH, { method: 'GET', headers })

        expect(response.status).toBe(401)
      })
    })
  })

  // The gate must be inert for real traffic. These are the two shapes the consumers send.
  describe('when the caller does not declare a signer', () => {
    it.each([
      ['godot-explorer, which signs "{}" for its bodyless calls', {}],
      ['mobile-hub, which signs { origin: location.origin }', { origin: 'https://mobile-hub.decentraland.org' }]
    ])('should serve %s', async (_name, metadata) => {
      const headers = getAuthHeaders('GET', PATH, metadata, sign)

      const response = await components.localFetch.fetch(PATH, { method: 'GET', headers })

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ ok: true, data: null })
    })
  })

  describe('when the caller declares a signer that is not gated', () => {
    it('should serve the request, the gate naming scenes rather than requiring an allowlist', async () => {
      const headers = getAuthHeaders('GET', PATH, { signer: 'dcl:explorer' }, sign)

      const response = await components.localFetch.fetch(PATH, { method: 'GET', headers })

      expect(response.status).toBe(200)
    })
  })
})
