import { IAppAttestComponent } from '../../src/adapters/app-attest'

export function createAppAttestJestMockComponent(
  overrides: Partial<jest.Mocked<IAppAttestComponent>> = {}
): jest.Mocked<IAppAttestComponent> {
  return {
    issueChallenge: jest.fn().mockReturnValue({ challenge: 'test-challenge', expiresAt: '2099-01-01T00:00:00.000Z' }),
    verifyChallenge: jest.fn().mockReturnValue(Buffer.from('test-challenge-bytes')),
    verifyRegistration: jest.fn().mockReturnValue({ publicKeyPem: 'TEST_PUBLIC_KEY_PEM' }),
    ...overrides
  }
}
