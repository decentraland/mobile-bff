import { IMagicComponent, MagicDeletionResult } from '../../src/adapters/magic'

export function createMagicJestMockComponent(
  overrides: Partial<jest.Mocked<IMagicComponent>> = {}
): jest.Mocked<IMagicComponent> {
  return {
    requestDeletion: jest.fn().mockResolvedValue({ status: 'processed' } as MagicDeletionResult),
    ...overrides
  }
}

export function createMagicMockComponent(): IMagicComponent {
  return {
    requestDeletion: async (): Promise<MagicDeletionResult> => ({ status: 'processed' })
  }
}
