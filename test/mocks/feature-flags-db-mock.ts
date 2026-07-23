import { IFeatureFlagsDbComponent, FeatureFlagsMap } from '../../src/adapters/feature-flags-db'

export const DEFAULT_TEST_FLAGS: FeatureFlagsMap = {
  pulse: false,
  'dual-channel': true
}

// For unit tests - uses jest mocks
export function createFeatureFlagsDbJestMockComponent(
  overrides: Partial<jest.Mocked<IFeatureFlagsDbComponent>> = {}
): jest.Mocked<IFeatureFlagsDbComponent> {
  return {
    getAll: jest.fn().mockResolvedValue({ ...DEFAULT_TEST_FLAGS }),
    update: jest.fn().mockImplementation((changes: FeatureFlagsMap) =>
      Promise.resolve({ ...DEFAULT_TEST_FLAGS, ...changes })
    ),
    ...overrides
  }
}
