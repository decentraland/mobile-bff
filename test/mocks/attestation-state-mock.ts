import { IAttestationStateComponent } from '../../src/adapters/attestation-state'

export function createAttestationStateJestMockComponent(
  overrides: Partial<jest.Mocked<IAttestationStateComponent>> = {}
): jest.Mocked<IAttestationStateComponent> {
  return {
    issueChallenge: jest.fn().mockResolvedValue({
      challenge: 'test-challenge',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
    }),
    consumeChallenge: jest.fn().mockResolvedValue(null),
    registerKey: jest.fn().mockResolvedValue(undefined),
    getRegisteredKey: jest.fn().mockResolvedValue(null),
    updateKeyCounterIfGreater: jest.fn().mockResolvedValue(true),
    ...overrides
  }
}
