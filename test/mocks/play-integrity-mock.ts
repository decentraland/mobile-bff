import { IPlayIntegrityComponent } from '../../src/adapters/play-integrity'

export function createPlayIntegrityJestMockComponent(
  overrides: Partial<jest.Mocked<IPlayIntegrityComponent>> = {}
): jest.Mocked<IPlayIntegrityComponent> {
  return {
    verifyIntegrityToken: jest.fn().mockResolvedValue({
      payload: {
        requestDetails: { requestPackageName: 'com.test.app' },
        appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED' },
        deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_STRONG_INTEGRITY'] }
      }
    }),
    ...overrides
  }
}
