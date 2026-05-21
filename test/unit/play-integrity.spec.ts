import crypto from 'node:crypto'

import { createPlayIntegrityComponent, PlayIntegrityError } from '../../src/adapters/play-integrity'
import { createConfigJestMockComponent } from '../mocks/config-mock'

// We mock googleapis entirely — the component instantiates a Google Auth
// client and a playintegrity v1 stub at creation time, and we just need to
// control what decodeIntegrityToken returns to exercise the verdict-checking
// logic in the adapter.
const mockDecodeIntegrityToken = jest.fn()

jest.mock('googleapis', () => ({
  google: {
    auth: { GoogleAuth: jest.fn().mockImplementation(() => ({})) },
    playintegrity: jest.fn().mockReturnValue({
      v1: { decodeIntegrityToken: (...args: unknown[]) => mockDecodeIntegrityToken(...args) }
    })
  }
}))

const PACKAGE = 'com.example.app'

// Minimal stub credentials JSON. The adapter only validates that
// client_email and private_key are strings; it doesn't try to actually
// authenticate (that work happens inside the mocked google.auth client).
const STUB_SA_JSON = Buffer.from(
  JSON.stringify({ client_email: 'test@iam', private_key: 'STUB' })
).toString('base64')

function buildConfig(extras: Record<string, string> = {}) {
  return createConfigJestMockComponent({
    PLAY_INTEGRITY_PACKAGE_NAME: PACKAGE,
    PLAY_INTEGRITY_REQUIRED_VERDICTS: 'MEETS_STRONG_INTEGRITY',
    PLAY_INTEGRITY_SA_JSON: STUB_SA_JSON,
    ...extras
  })
}

function bodyHashB64u(rawBody: Buffer): string {
  return crypto.createHash('sha256').update(rawBody).digest('base64url')
}

function tokenPayload(overrides: Record<string, any> = {}, rawBody = Buffer.from('hello')) {
  return {
    data: {
      tokenPayloadExternal: {
        requestDetails: {
          requestPackageName: PACKAGE,
          requestHash: bodyHashB64u(rawBody),
          timestampMillis: String(Date.now()),
          ...overrides.requestDetails
        },
        appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED', ...overrides.appIntegrity },
        deviceIntegrity: {
          deviceRecognitionVerdict: ['MEETS_STRONG_INTEGRITY'],
          ...overrides.deviceIntegrity
        }
      }
    }
  }
}

describe('play-integrity adapter', () => {
  beforeEach(() => {
    mockDecodeIntegrityToken.mockReset()
  })

  describe('configuration', () => {
    it('throws if PLAY_INTEGRITY_REQUIRED_VERDICTS is empty', async () => {
      const config = buildConfig({ PLAY_INTEGRITY_REQUIRED_VERDICTS: ' , , ' })
      await expect(createPlayIntegrityComponent({ config } as any)).rejects.toThrow(/at least one verdict/)
    })

    it('throws if PLAY_INTEGRITY_SA_JSON is not valid base64-encoded JSON', async () => {
      const config = createConfigJestMockComponent({
        PLAY_INTEGRITY_PACKAGE_NAME: PACKAGE,
        PLAY_INTEGRITY_SA_JSON: Buffer.from('not-json').toString('base64')
      })
      await expect(createPlayIntegrityComponent({ config } as any)).rejects.toThrow(
        /could not be parsed as JSON/
      )
    })

    it('throws if PLAY_INTEGRITY_SA_JSON is missing required fields', async () => {
      const config = createConfigJestMockComponent({
        PLAY_INTEGRITY_PACKAGE_NAME: PACKAGE,
        PLAY_INTEGRITY_SA_JSON: Buffer.from(JSON.stringify({ client_email: 'x' })).toString('base64')
      })
      await expect(createPlayIntegrityComponent({ config } as any)).rejects.toThrow(
        /missing client_email or private_key/
      )
    })
  })

  describe('verifyIntegrityToken', () => {
    const rawBody = Buffer.from('{"chain":"polygon","message":"hi"}')

    it('returns the payload on a fresh, well-formed token', async () => {
      mockDecodeIntegrityToken.mockResolvedValue(tokenPayload({}, rawBody))
      const config = buildConfig()
      const adapter = await createPlayIntegrityComponent({ config } as any)
      const { payload } = await adapter.verifyIntegrityToken({ integrityToken: 'tok', rawBody })
      expect(payload.appIntegrity?.appRecognitionVerdict).toBe('PLAY_RECOGNIZED')
    })

    it('rejects when the upstream decode call throws', async () => {
      mockDecodeIntegrityToken.mockRejectedValue(new Error('quota exceeded'))
      const adapter = await createPlayIntegrityComponent({ config: buildConfig() } as any)
      await expect(adapter.verifyIntegrityToken({ integrityToken: 'tok', rawBody })).rejects.toMatchObject({
        code: 'ATTESTATION_ANDROID_INVALID_TOKEN'
      })
    })

    it('rejects when packageName in the token does not match config', async () => {
      mockDecodeIntegrityToken.mockResolvedValue(
        tokenPayload({ requestDetails: { requestPackageName: 'com.attacker.app' } }, rawBody)
      )
      const adapter = await createPlayIntegrityComponent({ config: buildConfig() } as any)
      await expect(adapter.verifyIntegrityToken({ integrityToken: 'tok', rawBody })).rejects.toMatchObject({
        code: 'ATTESTATION_ANDROID_PACKAGE_MISMATCH'
      })
    })

    it('rejects when requestHash does not match SHA256(body)', async () => {
      mockDecodeIntegrityToken.mockResolvedValue(
        tokenPayload({ requestDetails: { requestHash: bodyHashB64u(Buffer.from('OTHER')) } }, rawBody)
      )
      const adapter = await createPlayIntegrityComponent({ config: buildConfig() } as any)
      await expect(adapter.verifyIntegrityToken({ integrityToken: 'tok', rawBody })).rejects.toMatchObject({
        code: 'ATTESTATION_ANDROID_HASH_MISMATCH'
      })
    })

    it('accepts hex-encoded requestHash for back-compat with older clients', async () => {
      const hashHex = crypto.createHash('sha256').update(rawBody).digest('hex')
      mockDecodeIntegrityToken.mockResolvedValue(
        tokenPayload({ requestDetails: { requestHash: hashHex } }, rawBody)
      )
      const adapter = await createPlayIntegrityComponent({ config: buildConfig() } as any)
      await expect(
        adapter.verifyIntegrityToken({ integrityToken: 'tok', rawBody })
      ).resolves.toBeDefined()
    })

    it('accepts the classic-API "nonce" field as the body hash', async () => {
      const classicHash = bodyHashB64u(rawBody)
      mockDecodeIntegrityToken.mockResolvedValue(
        tokenPayload(
          { requestDetails: { requestHash: undefined, nonce: classicHash } },
          rawBody
        )
      )
      const adapter = await createPlayIntegrityComponent({ config: buildConfig() } as any)
      await expect(
        adapter.verifyIntegrityToken({ integrityToken: 'tok', rawBody })
      ).resolves.toBeDefined()
    })

    it('rejects stale tokens (timestamp outside freshness window)', async () => {
      const tenMinAgo = String(Date.now() - 10 * 60 * 1000)
      mockDecodeIntegrityToken.mockResolvedValue(
        tokenPayload({ requestDetails: { timestampMillis: tenMinAgo } }, rawBody)
      )
      const adapter = await createPlayIntegrityComponent({ config: buildConfig() } as any)
      await expect(adapter.verifyIntegrityToken({ integrityToken: 'tok', rawBody })).rejects.toMatchObject({
        code: 'ATTESTATION_ANDROID_TOKEN_STALE'
      })
    })

    it('rejects tokens dated more than ~30s in the future', async () => {
      const twoMinutesAhead = String(Date.now() + 2 * 60 * 1000)
      mockDecodeIntegrityToken.mockResolvedValue(
        tokenPayload({ requestDetails: { timestampMillis: twoMinutesAhead } }, rawBody)
      )
      const adapter = await createPlayIntegrityComponent({ config: buildConfig() } as any)
      await expect(adapter.verifyIntegrityToken({ integrityToken: 'tok', rawBody })).rejects.toMatchObject({
        code: 'ATTESTATION_ANDROID_TOKEN_STALE'
      })
    })

    it('rejects when appRecognitionVerdict is not PLAY_RECOGNIZED', async () => {
      mockDecodeIntegrityToken.mockResolvedValue(
        tokenPayload({ appIntegrity: { appRecognitionVerdict: 'UNRECOGNIZED_VERSION' } }, rawBody)
      )
      const adapter = await createPlayIntegrityComponent({ config: buildConfig() } as any)
      await expect(adapter.verifyIntegrityToken({ integrityToken: 'tok', rawBody })).rejects.toMatchObject({
        code: 'ATTESTATION_ANDROID_VERDICT_FAILED'
      })
    })

    it('rejects when required device verdicts are not all present', async () => {
      mockDecodeIntegrityToken.mockResolvedValue(
        tokenPayload(
          { deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_BASIC_INTEGRITY'] } },
          rawBody
        )
      )
      const adapter = await createPlayIntegrityComponent({ config: buildConfig() } as any)
      await expect(adapter.verifyIntegrityToken({ integrityToken: 'tok', rawBody })).rejects.toMatchObject({
        code: 'ATTESTATION_ANDROID_VERDICT_FAILED'
      })
    })

    it('PlayIntegrityError extras carry the failing verdict data', async () => {
      mockDecodeIntegrityToken.mockResolvedValue(
        tokenPayload(
          { deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] } },
          rawBody
        )
      )
      const adapter = await createPlayIntegrityComponent({ config: buildConfig() } as any)
      try {
        await adapter.verifyIntegrityToken({ integrityToken: 'tok', rawBody })
        fail('expected throw')
      } catch (e) {
        expect(e).toBeInstanceOf(PlayIntegrityError)
        expect((e as PlayIntegrityError).extra).toMatchObject({
          deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'],
          missing: ['MEETS_STRONG_INTEGRITY']
        })
      }
    })
  })
})
