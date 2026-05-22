import { createAppAttestComponent } from '../../src/adapters/app-attest'
import { createConfigJestMockComponent } from '../mocks/config-mock'

const VALID_SECRET = 'a'.repeat(32)
const baseConfig = {
  APP_ATTEST_APP_ID: '8T73XM973P.org.example.app',
  APP_ATTEST_ENV: 'development',
  ATTESTATION_SESSION_SECRET: VALID_SECRET
}

describe('app-attest stateless challenge', () => {
  async function build(overrides: Record<string, string | undefined> = {}) {
    const config = createConfigJestMockComponent({ ...baseConfig, ...overrides })
    return createAppAttestComponent({ config })
  }

  it('throws at construction when the session secret is too short', async () => {
    await expect(build({ ATTESTATION_SESSION_SECRET: 'short' })).rejects.toThrow(/at least 32 chars/)
  })

  it('round-trips: a freshly issued challenge verifies and returns the original bytes', async () => {
    const appAttest = await build()
    const { challenge, expiresAt } = appAttest.issueChallenge()
    expect(typeof challenge).toBe('string')
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now())
    const bytes = appAttest.verifyChallenge(challenge)
    expect(bytes).not.toBeNull()
    // The decoded buffer is exactly what was base64url-encoded into `challenge`.
    expect(bytes!.toString('base64url')).toBe(challenge)
    // 40 bytes total: nonce16 || expU64BE || mac16.
    expect(bytes!.length).toBe(40)
  })

  it('rejects an empty or non-string input', async () => {
    const appAttest = await build()
    expect(appAttest.verifyChallenge('')).toBeNull()
    expect(appAttest.verifyChallenge(null as any)).toBeNull()
  })

  it('rejects a challenge of unexpected length', async () => {
    const appAttest = await build()
    expect(appAttest.verifyChallenge(Buffer.alloc(20).toString('base64url'))).toBeNull()
  })

  it('rejects a challenge whose mac was tampered with', async () => {
    const appAttest = await build()
    const { challenge } = appAttest.issueChallenge()
    const bytes = Buffer.from(challenge, 'base64url')
    // Flip a bit inside the mac region (last 16 bytes).
    bytes[bytes.length - 1] ^= 0x01
    expect(appAttest.verifyChallenge(bytes.toString('base64url'))).toBeNull()
  })

  it('rejects a challenge whose expiry was rolled forward', async () => {
    const appAttest = await build()
    const { challenge } = appAttest.issueChallenge()
    const bytes = Buffer.from(challenge, 'base64url')
    // Tamper with the exp bytes; the mac will no longer match.
    bytes[16] ^= 0xff
    expect(appAttest.verifyChallenge(bytes.toString('base64url'))).toBeNull()
  })

  it('rejects an expired challenge', async () => {
    const appAttest = await build()
    const { challenge } = appAttest.issueChallenge()
    // Advance the clock past the 5-minute TTL.
    const realNow = Date.now
    jest.spyOn(Date, 'now').mockImplementation(() => realNow() + 6 * 60 * 1000)
    try {
      expect(appAttest.verifyChallenge(challenge)).toBeNull()
    } finally {
      ;(Date.now as any).mockRestore()
    }
  })

  it('rejects a challenge minted with a different secret (cross-tenant safety)', async () => {
    const appAttestA = await build()
    const appAttestB = await build({ ATTESTATION_SESSION_SECRET: 'b'.repeat(32) })
    const { challenge } = appAttestA.issueChallenge()
    expect(appAttestB.verifyChallenge(challenge)).toBeNull()
  })
})
