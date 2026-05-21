import crypto from 'node:crypto'

import { createAttestationSessionComponent } from '../../src/adapters/attestation-session'
import { createConfigJestMockComponent } from '../mocks/config-mock'

const STRONG_SECRET = 'a'.repeat(32) // exactly the minimum

function buildConfig(extras: Record<string, string> = {}) {
  return createConfigJestMockComponent({
    ATTESTATION_SESSION_SECRET: STRONG_SECRET,
    ...extras
  })
}

describe('attestation-session', () => {
  describe('startup validation', () => {
    it('rejects a secret shorter than 32 chars', async () => {
      const config = createConfigJestMockComponent({ ATTESTATION_SESSION_SECRET: 'short' })
      await expect(createAttestationSessionComponent({ config } as any)).rejects.toThrow(
        /at least 32 chars/
      )
    })

    it('requires the secret to be set', async () => {
      const config = createConfigJestMockComponent({})
      await expect(createAttestationSessionComponent({ config } as any)).rejects.toThrow()
    })
  })

  describe('issue + verify happy path', () => {
    it('issues a token that verifies back', async () => {
      const session = await createAttestationSessionComponent({ config: buildConfig() } as any)
      const { token, expiresAt } = session.issue({ platform: 'ios' })
      expect(typeof token).toBe('string')
      expect(token).toMatch(/^[\w-]+\.[\w-]+$/)
      expect(expiresAt).toBeGreaterThan(Date.now())
      const res = session.verify(token)
      expect(res.ok).toBe(true)
      if (res.ok && res.payload) {
        expect(res.payload.platform).toBe('ios')
        expect(res.payload.v).toBe(1)
        expect(typeof res.payload.jti).toBe('string')
        expect(res.payload.exp).toBe(expiresAt)
      }
    })

    it('embeds the platform passed to issue', async () => {
      const session = await createAttestationSessionComponent({ config: buildConfig() } as any)
      const { token } = session.issue({ platform: 'android' })
      const res = session.verify(token)
      expect(res.ok).toBe(true)
      if (res.ok) expect(res.payload.platform).toBe('android')
    })

    it('jti is unique per call (rules out token-equality collisions)', async () => {
      const session = await createAttestationSessionComponent({ config: buildConfig() } as any)
      const a = session.issue({ platform: 'ios' })
      const b = session.issue({ platform: 'ios' })
      const aPayload = session.verify(a.token)
      const bPayload = session.verify(b.token)
      expect(aPayload.ok && bPayload.ok).toBe(true)
      if (aPayload.ok && bPayload.ok && aPayload.payload && bPayload.payload) {
        expect(aPayload.payload.jti).not.toBe(bPayload.payload.jti)
      }
    })

    it('honors ATTESTATION_SESSION_TTL_MS override', async () => {
      const session = await createAttestationSessionComponent({
        config: buildConfig({ ATTESTATION_SESSION_TTL_MS: '60000' })
      } as any)
      const before = Date.now()
      const { expiresAt } = session.issue({ platform: 'ios' })
      // 60s ± a few ms of clock drift between the read and the call.
      expect(expiresAt - before).toBeGreaterThanOrEqual(59_000)
      expect(expiresAt - before).toBeLessThanOrEqual(61_000)
    })
  })

  describe('verify failure modes', () => {
    it('rejects an empty token', async () => {
      const session = await createAttestationSessionComponent({ config: buildConfig() } as any)
      const res = session.verify('')
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.code).toBe('ATTESTATION_SESSION_MALFORMED')
    })

    it('rejects a token without a dot separator', async () => {
      const session = await createAttestationSessionComponent({ config: buildConfig() } as any)
      const res = session.verify('noseparator')
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.code).toBe('ATTESTATION_SESSION_MALFORMED')
    })

    it('rejects a token with empty payload or tag', async () => {
      const session = await createAttestationSessionComponent({ config: buildConfig() } as any)
      expect(session.verify('.tag').ok).toBe(false)
      expect(session.verify('payload.').ok).toBe(false)
    })

    it('rejects a tampered tag (BAD_SIGNATURE)', async () => {
      const session = await createAttestationSessionComponent({ config: buildConfig() } as any)
      const { token } = session.issue({ platform: 'ios' })
      const tampered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A')
      const res = session.verify(tampered)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.code).toBe('ATTESTATION_SESSION_BAD_SIGNATURE')
    })

    it('rejects a tampered payload (BAD_SIGNATURE, since the tag no longer matches)', async () => {
      const session = await createAttestationSessionComponent({ config: buildConfig() } as any)
      const { token } = session.issue({ platform: 'ios' })
      const [payload, tag] = token.split('.')
      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
      decoded.platform = 'android'
      const newPayload = Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url')
      const res = session.verify(`${newPayload}.${tag}`)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.code).toBe('ATTESTATION_SESSION_BAD_SIGNATURE')
    })

    it('rejects a token signed with a different secret', async () => {
      const a = await createAttestationSessionComponent({ config: buildConfig() } as any)
      const b = await createAttestationSessionComponent({
        config: createConfigJestMockComponent({ ATTESTATION_SESSION_SECRET: 'b'.repeat(32) })
      } as any)
      const { token } = a.issue({ platform: 'ios' })
      const res = b.verify(token)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.code).toBe('ATTESTATION_SESSION_BAD_SIGNATURE')
    })

    it('rejects an expired token (EXPIRED)', async () => {
      const session = await createAttestationSessionComponent({
        config: buildConfig({ ATTESTATION_SESSION_TTL_MS: '1' })
      } as any)
      const { token } = session.issue({ platform: 'ios' })
      // Wait past the 1ms TTL.
      await new Promise((r) => setTimeout(r, 10))
      const res = session.verify(token)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.code).toBe('ATTESTATION_SESSION_EXPIRED')
    })

    it('rejects a token with an unknown version (BAD_VERSION)', async () => {
      const session = await createAttestationSessionComponent({ config: buildConfig() } as any)
      // Build a token by hand with v=99 but a valid HMAC, simulating a
      // future format we haven't shipped yet.
      const payload = { v: 99, platform: 'ios', iat: Date.now(), exp: Date.now() + 60_000, jti: 'xx' }
      const payloadB64u = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
      const tag = crypto.createHmac('sha256', STRONG_SECRET).update(payloadB64u).digest('base64url')
      const res = session.verify(`${payloadB64u}.${tag}`)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.code).toBe('ATTESTATION_SESSION_BAD_VERSION')
    })
  })
})
