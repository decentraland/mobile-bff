import { createTestMetricsComponent } from '@well-known-components/metrics'

import { createAttestationVerifierComponent } from '../../src/adapters/attestation-verifier'
import { AppAttestError } from '../../src/adapters/app-attest'
import { PlayIntegrityError } from '../../src/adapters/play-integrity'
import { metricDeclarations } from '../../src/metrics'
import { createAttestationStateJestMockComponent } from '../mocks/attestation-state-mock'
import { createAppAttestJestMockComponent } from '../mocks/app-attest-mock'
import { createPlayIntegrityJestMockComponent } from '../mocks/play-integrity-mock'
import { createLogsMockComponent } from '../mocks/logs-mock'

describe('attestation-verifier', () => {
  function mkHeaders(headers: Record<string, string>) {
    const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
    return { get: (k: string) => map.get(k.toLowerCase()) ?? null }
  }

  async function buildVerifier(overrides: {
    state?: ReturnType<typeof createAttestationStateJestMockComponent>
    appAttest?: ReturnType<typeof createAppAttestJestMockComponent>
    playIntegrity?: ReturnType<typeof createPlayIntegrityJestMockComponent>
  } = {}) {
    const state = overrides.state ?? createAttestationStateJestMockComponent()
    const appAttest = overrides.appAttest ?? createAppAttestJestMockComponent()
    const playIntegrity = overrides.playIntegrity ?? createPlayIntegrityJestMockComponent()
    const logs = createLogsMockComponent()
    const metrics = createTestMetricsComponent(metricDeclarations)
    const verifier = await createAttestationVerifierComponent({
      appAttest,
      playIntegrity,
      attestationState: state,
      logs,
      metrics
    } as any)
    return { verifier, state, appAttest, playIntegrity, metrics }
  }

  describe('platform routing', () => {
    it('returns ATTESTATION_MISSING when x-attest-platform header is absent', async () => {
      const { verifier } = await buildVerifier()
      const out = await verifier.verify({ headers: mkHeaders({}), rawBody: Buffer.from('') })
      expect(out).toMatchObject({ ok: false, code: 'ATTESTATION_MISSING', platform: 'unknown' })
    })

    it('returns ATTESTATION_UNKNOWN_PLATFORM for unsupported platform value', async () => {
      const { verifier } = await buildVerifier()
      const out = await verifier.verify({
        headers: mkHeaders({ 'x-attest-platform': 'symbian' }),
        rawBody: Buffer.from('')
      })
      expect(out.code).toBe('ATTESTATION_UNKNOWN_PLATFORM')
      expect(out.platform).toBe('symbian')
    })
  })

  describe('ios path', () => {
    const iosHeaders = {
      'x-attest-platform': 'ios',
      'x-attest-key-id': 'a'.repeat(43), // base64url of 32 bytes
      'x-attest-assertion': 'YXNzZXJ0aW9u',
      'x-attest-nonce': 'bm9uY2U'
    }

    it('returns ATTESTATION_IOS_MISSING_HEADERS when any of key-id/assertion/nonce is missing', async () => {
      const { verifier } = await buildVerifier()
      const out = await verifier.verify({
        headers: mkHeaders({ 'x-attest-platform': 'ios' }),
        rawBody: Buffer.from('')
      })
      expect(out.code).toBe('ATTESTATION_IOS_MISSING_HEADERS')
    })

    it('returns ATTESTATION_IOS_KEY_NOT_REGISTERED when the key is unknown', async () => {
      const state = createAttestationStateJestMockComponent()
      state.getRegisteredKey.mockResolvedValue(null)
      const { verifier } = await buildVerifier({ state })
      const out = await verifier.verify({ headers: mkHeaders(iosHeaders), rawBody: Buffer.from('') })
      expect(out.code).toBe('ATTESTATION_IOS_KEY_NOT_REGISTERED')
      expect(out.keyIdPrefix).toBe(iosHeaders['x-attest-key-id'].slice(0, 8))
    })

    it('returns OK on a valid assertion and advances the counter', async () => {
      const state = createAttestationStateJestMockComponent()
      state.getRegisteredKey.mockResolvedValue({ publicKeyPem: 'PEM', counter: 5 })
      state.updateKeyCounterIfGreater.mockResolvedValue({ status: 'advanced' })
      const appAttest = createAppAttestJestMockComponent()
      appAttest.verifyAssertion.mockReturnValue({ newCounter: 6 })
      const { verifier } = await buildVerifier({ state, appAttest })
      const out = await verifier.verify({ headers: mkHeaders(iosHeaders), rawBody: Buffer.from('') })
      expect(out).toMatchObject({ ok: true, platform: 'ios', code: 'OK' })
      expect(state.updateKeyCounterIfGreater).toHaveBeenCalledWith(iosHeaders['x-attest-key-id'], 6)
    })

    it('returns ATTESTATION_IOS_COUNTER_REPLAY when CAS update loses to a concurrent advance', async () => {
      const state = createAttestationStateJestMockComponent()
      state.getRegisteredKey.mockResolvedValue({ publicKeyPem: 'PEM', counter: 5 })
      state.updateKeyCounterIfGreater.mockResolvedValue({ status: 'counter_not_greater' })
      const appAttest = createAppAttestJestMockComponent()
      appAttest.verifyAssertion.mockReturnValue({ newCounter: 6 })
      const { verifier } = await buildVerifier({ state, appAttest })
      const out = await verifier.verify({ headers: mkHeaders(iosHeaders), rawBody: Buffer.from('') })
      expect(out.ok).toBe(false)
      expect(out.code).toBe('ATTESTATION_IOS_COUNTER_REPLAY')
    })

    it('returns ATTESTATION_IOS_KEY_NOT_REGISTERED when the row vanishes mid-flight', async () => {
      const state = createAttestationStateJestMockComponent()
      state.getRegisteredKey.mockResolvedValue({ publicKeyPem: 'PEM', counter: 5 })
      state.updateKeyCounterIfGreater.mockResolvedValue({ status: 'key_missing' })
      const appAttest = createAppAttestJestMockComponent()
      appAttest.verifyAssertion.mockReturnValue({ newCounter: 6 })
      const { verifier } = await buildVerifier({ state, appAttest })
      const out = await verifier.verify({ headers: mkHeaders(iosHeaders), rawBody: Buffer.from('') })
      expect(out.ok).toBe(false)
      expect(out.code).toBe('ATTESTATION_IOS_KEY_NOT_REGISTERED')
    })

    it('propagates COUNTER_REPLAY code from AppAttestError', async () => {
      const state = createAttestationStateJestMockComponent()
      state.getRegisteredKey.mockResolvedValue({ publicKeyPem: 'PEM', counter: 10 })
      const appAttest = createAppAttestJestMockComponent()
      appAttest.verifyAssertion.mockImplementation(() => {
        throw new AppAttestError('ATTESTATION_IOS_COUNTER_REPLAY', 'counter replay (stored=10, received=5)')
      })
      const { verifier } = await buildVerifier({ state, appAttest })
      const out = await verifier.verify({ headers: mkHeaders(iosHeaders), rawBody: Buffer.from('') })
      expect(out.code).toBe('ATTESTATION_IOS_COUNTER_REPLAY')
    })

    it('propagates BAD_CBOR code from AppAttestError', async () => {
      const state = createAttestationStateJestMockComponent()
      state.getRegisteredKey.mockResolvedValue({ publicKeyPem: 'PEM', counter: 0 })
      const appAttest = createAppAttestJestMockComponent()
      appAttest.verifyAssertion.mockImplementation(() => {
        throw new AppAttestError('ATTESTATION_IOS_BAD_CBOR', 'assertion is not valid CBOR: bad token')
      })
      const { verifier } = await buildVerifier({ state, appAttest })
      const out = await verifier.verify({ headers: mkHeaders(iosHeaders), rawBody: Buffer.from('') })
      expect(out.code).toBe('ATTESTATION_IOS_BAD_CBOR')
    })

    it('propagates BAD_SIGNATURE code from AppAttestError', async () => {
      const state = createAttestationStateJestMockComponent()
      state.getRegisteredKey.mockResolvedValue({ publicKeyPem: 'PEM', counter: 0 })
      const appAttest = createAppAttestJestMockComponent()
      appAttest.verifyAssertion.mockImplementation(() => {
        throw new AppAttestError('ATTESTATION_IOS_BAD_SIGNATURE', 'assertion signature invalid')
      })
      const { verifier } = await buildVerifier({ state, appAttest })
      const out = await verifier.verify({ headers: mkHeaders(iosHeaders), rawBody: Buffer.from('') })
      expect(out.code).toBe('ATTESTATION_IOS_BAD_SIGNATURE')
    })

    it('falls back to BAD_ASSERTION for non-AppAttestError throws', async () => {
      const state = createAttestationStateJestMockComponent()
      state.getRegisteredKey.mockResolvedValue({ publicKeyPem: 'PEM', counter: 0 })
      const appAttest = createAppAttestJestMockComponent()
      appAttest.verifyAssertion.mockImplementation(() => {
        throw new Error('something else went wrong')
      })
      const { verifier } = await buildVerifier({ state, appAttest })
      const out = await verifier.verify({ headers: mkHeaders(iosHeaders), rawBody: Buffer.from('') })
      expect(out.code).toBe('ATTESTATION_IOS_BAD_ASSERTION')
    })
  })

  describe('android path', () => {
    const androidHeaders = {
      'x-attest-platform': 'android',
      'x-attest-integrity-token': 'tok'
    }

    it('returns INVALID_TOKEN when the integrity token header is missing', async () => {
      const { verifier } = await buildVerifier()
      const out = await verifier.verify({
        headers: mkHeaders({ 'x-attest-platform': 'android' }),
        rawBody: Buffer.from('')
      })
      expect(out.code).toBe('ATTESTATION_ANDROID_INVALID_TOKEN')
    })

    it('returns OK with verdicts on success', async () => {
      const playIntegrity = createPlayIntegrityJestMockComponent()
      const { verifier } = await buildVerifier({ playIntegrity })
      const out = await verifier.verify({
        headers: mkHeaders(androidHeaders),
        rawBody: Buffer.from('')
      })
      expect(out).toMatchObject({ ok: true, platform: 'android', code: 'OK' })
      expect(out.verdicts).toEqual(['MEETS_STRONG_INTEGRITY'])
    })

    it('relays PlayIntegrityError code and message', async () => {
      const playIntegrity = createPlayIntegrityJestMockComponent()
      playIntegrity.verifyIntegrityToken.mockRejectedValue(
        new PlayIntegrityError('ATTESTATION_ANDROID_HASH_MISMATCH', 'hash differs', { foo: 1 })
      )
      const { verifier } = await buildVerifier({ playIntegrity })
      const out = await verifier.verify({
        headers: mkHeaders(androidHeaders),
        rawBody: Buffer.from('')
      })
      expect(out.code).toBe('ATTESTATION_ANDROID_HASH_MISMATCH')
      expect(out.error).toBe('hash differs')
      expect(out.details).toEqual({ foo: 1 })
    })

    it('wraps unexpected (non-PlayIntegrityError) failures as INVALID_TOKEN', async () => {
      const playIntegrity = createPlayIntegrityJestMockComponent()
      playIntegrity.verifyIntegrityToken.mockRejectedValue(new Error('boom'))
      const { verifier } = await buildVerifier({ playIntegrity })
      const out = await verifier.verify({
        headers: mkHeaders(androidHeaders),
        rawBody: Buffer.from('')
      })
      expect(out.code).toBe('ATTESTATION_ANDROID_INVALID_TOKEN')
      expect(out.error).toMatch(/unexpected: boom/)
    })
  })
})
