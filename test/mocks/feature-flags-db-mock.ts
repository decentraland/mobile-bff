import {
  IFeatureFlagsDbComponent,
  FeatureFlag,
  FeatureFlagsMap,
  CreateFeatureFlagInput,
  UpdateFeatureFlagInput
} from '../../src/adapters/feature-flags-db'

export const DEFAULT_TEST_FLAGS: FeatureFlagsMap = {
  pulse: false,
  'dual-channel': true
}

export function createTestFeatureFlag(overrides: Partial<FeatureFlag> = {}): FeatureFlag {
  return {
    name: 'pulse',
    enabled: false,
    description: 'Test flag description',
    updatedAt: '2026-07-23T00:00:00.000Z',
    updatedBy: null,
    ...overrides
  }
}

export const DEFAULT_TEST_FLAGS_DETAILED: FeatureFlag[] = [
  createTestFeatureFlag({ name: 'dual-channel', enabled: true }),
  createTestFeatureFlag({ name: 'pulse', enabled: false })
]

// For unit tests - uses jest mocks
export function createFeatureFlagsDbJestMockComponent(
  overrides: Partial<jest.Mocked<IFeatureFlagsDbComponent>> = {}
): jest.Mocked<IFeatureFlagsDbComponent> {
  return {
    getAll: jest.fn().mockResolvedValue({ ...DEFAULT_TEST_FLAGS }),
    getAllDetailed: jest.fn().mockResolvedValue([...DEFAULT_TEST_FLAGS_DETAILED]),
    create: jest.fn().mockImplementation((input: CreateFeatureFlagInput, createdBy: string) =>
      Promise.resolve(createTestFeatureFlag({ ...input, updatedBy: createdBy }))
    ),
    update: jest.fn().mockImplementation((name: string, changes: UpdateFeatureFlagInput, updatedBy: string) => {
      const base = createTestFeatureFlag({ name, updatedBy })
      return Promise.resolve({
        ...base,
        ...(changes.enabled !== undefined ? { enabled: changes.enabled } : {}),
        ...(changes.description !== undefined ? { description: changes.description } : {})
      })
    }),
    delete: jest.fn().mockResolvedValue(true),
    ...overrides
  }
}
