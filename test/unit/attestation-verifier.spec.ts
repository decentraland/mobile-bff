import { createTestMetricsComponent } from '@well-known-components/metrics'

import { createAttestationVerifierComponent } from '../../src/adapters/attestation-verifier'
import { AppAttestError } from '../../src/adapters/app-attest'
import { PlayIntegrityError } from '../../src/adapters/play-integrity'
import { metricDeclarations } from '../../src/metrics'
import { createAppAttestJestMockComponent } from '../mocks/app-attest-mock'
import { createPlayIntegrityJestMockComponent } from '../mocks/play-integrity-mock'
import { createLogsMockComponent } from '../mocks/logs-mock'

describe('attestation-verifier', () => {
  function mkHeaders(headers: Record<string, string>) {
    const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
    return { get: (k: string) => map.get(k.toLowerCase()) ?? null }
  }

  async function buildVerifier(overrides: {
    appAttest?: ReturnType<typeof createAppAttestJestMockComponent>
    playIntegrity?: ReturnType<typeof createPlayIntegrityJestMockComponent>
  } = {}) {
    const appAttest = overrides.appAttest ?? createAppAttestJestMockComponent()
    const playIntegrity = overrides.playIntegrity ?? createPlayIntegrityJestMockComponent()
    const logs = createLogsMockComponent()
    const metrics = createTestMetricsComponent(metricDeclarations)
    const verifier = await createAttestationVerifierComponent({
      appAttest,
      playIntegrity,
      logs,
      metrics
    } as any)
    return { verifier, appAttest, playIntegrity, metrics }
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
    const iosHeaders = { 'x-attest-platform': 'ios' }
    const validBody = (overrides: Record<string, unknown> = {}) =>
      Buffer.from(
        JSON.stringify({
          key_id: 'a'.repeat(43),
          attestation_object: 'YXR0',
          challenge: 'Y2g',
          ...overrides
        }),
        'utf8'
      )

    it('returns ATTESTATION_IOS_BAD_BODY when the body is not valid JSON', async () => {
      const { verifier } = await buildVerifier()
      const out = await verifier.verify({ headers: mkHeaders(iosHeaders), rawBody: Buffer.from('not-json') })
      expect(out.code).toBe('ATTESTATION_IOS_BAD_BODY')
    })

    it.each([
      ['missing key_id', { key_id: undefined }],
      ['missing attestation_object', { attestation_object: undefined }],
      ['missing challenge', { challenge: undefined }],
      ['non-string key_id', { key_id: 1 }]
    ])('returns ATTESTATION_IOS_BAD_BODY for %s', async (_name, overrides) => {
      const { verifier } = await buildVerifier()
      const body = { key_id: 'k', attestation_object: 'a', challenge: 'c', ...overrides }
      const out = await verifier.verify({
        headers: mkHeaders(iosHeaders),
        rawBody: Buffer.from(JSON.stringify(body), 'utf8')
      })
      expect(out.code).toBe('ATTESTATION_IOS_BAD_BODY')
    })

    it('returns ATTESTATION_IOS_BAD_CHALLENGE when verifyChallenge returns null', async () => {
      const appAttest = createAppAttestJestMockComponent()
      appAttest.verifyChallenge.mockReturnValue(null)
      const { verifier } = await buildVerifier({ appAttest })
      const out = await verifier.verify({ headers: mkHeaders(iosHeaders), rawBody: validBody() })
      expect(out.code).toBe('ATTESTATION_IOS_BAD_CHALLENGE')
      expect(out.keyIdPrefix).toBe('a'.repeat(8))
    })

    it('returns OK on a valid registration and forwards the recovered challenge bytes', async () => {
      const appAttest = createAppAttestJestMockComponent()
      const recovered = Buffer.from('recovered-challenge-bytes')
      appAttest.verifyChallenge.mockReturnValue(recovered)
      appAttest.verifyRegistration.mockReturnValue({ publicKeyPem: 'PEM' })
      const { verifier } = await buildVerifier({ appAttest })
      const out = await verifier.verify({ headers: mkHeaders(iosHeaders), rawBody: validBody() })
      expect(out).toMatchObject({ ok: true, platform: 'ios', code: 'OK' })
      expect(appAttest.verifyRegistration).toHaveBeenCalledWith({
        keyIdB64u: 'a'.repeat(43),
        attestationObjectB64u: 'YXR0',
        challengeBytes: recovered
      })
    })

    it('propagates BAD_CBOR code from AppAttestError', async () => {
      const appAttest = createAppAttestJestMockComponent()
      appAttest.verifyRegistration.mockImplementation(() => {
        throw new AppAttestError('ATTESTATION_IOS_BAD_CBOR', 'attestation_object is not valid CBOR')
      })
      const { verifier } = await buildVerifier({ appAttest })
      const out = await verifier.verify({ headers: mkHeaders(iosHeaders), rawBody: validBody() })
      expect(out.code).toBe('ATTESTATION_IOS_BAD_CBOR')
    })

    it('propagates BAD_ASSERTION code from AppAttestError', async () => {
      const appAttest = createAppAttestJestMockComponent()
      appAttest.verifyRegistration.mockImplementation(() => {
        throw new AppAttestError('ATTESTATION_IOS_BAD_ASSERTION', 'aaguid mismatch')
      })
      const { verifier } = await buildVerifier({ appAttest })
      const out = await verifier.verify({ headers: mkHeaders(iosHeaders), rawBody: validBody() })
      expect(out.code).toBe('ATTESTATION_IOS_BAD_ASSERTION')
    })

    it('falls back to BAD_ASSERTION for non-AppAttestError throws', async () => {
      const appAttest = createAppAttestJestMockComponent()
      appAttest.verifyRegistration.mockImplementation(() => {
        throw new Error('something else went wrong')
      })
      const { verifier } = await buildVerifier({ appAttest })
      const out = await verifier.verify({ headers: mkHeaders(iosHeaders), rawBody: validBody() })
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
