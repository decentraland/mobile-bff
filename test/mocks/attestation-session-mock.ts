import { IAttestationSessionComponent } from '../../src/adapters/attestation-session'

export function createAttestationSessionJestMockComponent(
  overrides: Partial<jest.Mocked<IAttestationSessionComponent>> = {}
): jest.Mocked<IAttestationSessionComponent> {
  return {
    issue: jest.fn().mockReturnValue({ token: 'mock.token', expiresAt: Date.now() + 3600_000 }),
    verify: jest.fn().mockReturnValue({
      ok: true,
      payload: { v: 1, platform: 'ios', iat: Date.now() - 1000, exp: Date.now() + 3600_000, jti: 'mock-jti' }
    }),
    ...overrides
  }
}
