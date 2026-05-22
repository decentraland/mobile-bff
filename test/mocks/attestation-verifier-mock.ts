import { IAttestationVerifierComponent, AttestationOutcome } from '../../src/adapters/attestation-verifier'

export function createAttestationVerifierJestMockComponent(
  overrides: Partial<jest.Mocked<IAttestationVerifierComponent>> = {}
): jest.Mocked<IAttestationVerifierComponent> {
  const okOutcome: AttestationOutcome = { ok: true, platform: 'ios', code: 'OK', keyIdPrefix: 'abcd1234' }
  return {
    verify: jest.fn().mockResolvedValue(okOutcome),
    ...overrides
  }
}
