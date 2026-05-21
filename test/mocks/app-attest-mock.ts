import { IAppAttestComponent } from '../../src/adapters/app-attest'

export function createAppAttestJestMockComponent(
  overrides: Partial<jest.Mocked<IAppAttestComponent>> = {}
): jest.Mocked<IAppAttestComponent> {
  return {
    verifyRegistration: jest.fn().mockReturnValue({ publicKeyPem: 'TEST_PUBLIC_KEY_PEM' }),
    verifyAssertion: jest.fn().mockReturnValue({ newCounter: 1 }),
    ...overrides
  }
}
