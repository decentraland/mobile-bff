import {
  IFeatureFlagsDbComponent,
  FeatureFlag,
  FeatureFlagsMap,
  CreateFeatureFlagInput,
  UpdateFeatureFlagInput
} from '../../src/adapters/feature-flags-db'

export const DEFAULT_TEST_FLAGS: FeatureFlagsMap = {
  pulse: false,
  'dual-channel': true,
  'sentry-sample-rate': 1
}

export function createTestFeatureFlag(overrides: Partial<FeatureFlag> = {}): FeatureFlag {
  return {
    name: 'pulse',
    type: 'on-off',
    enabled: false,
    value: null,
    description: 'Test flag description',
    updatedAt: '2026-07-23T00:00:00.000Z',
    updatedBy: null,
    ...overrides
  }
}

export const DEFAULT_TEST_FLAGS_DETAILED: FeatureFlag[] = [
  createTestFeatureFlag({ name: 'dual-channel', enabled: true }),
  createTestFeatureFlag({ name: 'pulse', enabled: false }),
  createTestFeatureFlag({ name: 'sentry-sample-rate', type: 'number', value: 1 })
]

// For unit tests - uses jest mocks
export function createFeatureFlagsDbJestMockComponent(
  overrides: Partial<jest.Mocked<IFeatureFlagsDbComponent>> = {}
): jest.Mocked<IFeatureFlagsDbComponent> {
  return {
    getAll: jest.fn().mockResolvedValue({ ...DEFAULT_TEST_FLAGS }),
    getAllDetailed: jest.fn().mockResolvedValue([...DEFAULT_TEST_FLAGS_DETAILED]),
    getByName: jest.fn().mockImplementation((name: string) =>
      Promise.resolve(createTestFeatureFlag({ name }))
    ),
    create: jest.fn().mockImplementation((input: CreateFeatureFlagInput, createdBy: string) =>
      Promise.resolve(createTestFeatureFlag({
        ...input,
        value: input.type === 'number' && input.value !== null ? Number(input.value) : input.value,
        updatedBy: createdBy
      }))
    ),
    update: jest.fn().mockImplementation((name: string, changes: UpdateFeatureFlagInput, updatedBy: string) => {
      const base = createTestFeatureFlag({ name, updatedBy })
      return Promise.resolve({
        ...base,
        ...(changes.enabled !== undefined ? { enabled: changes.enabled } : {}),
        ...(changes.value !== undefined ? { value: changes.value } : {}),
        ...(changes.description !== undefined ? { description: changes.description } : {})
      })
    }),
    delete: jest.fn().mockResolvedValue(true),
    ...overrides
  }
}
