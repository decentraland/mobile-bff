import { IDeviceSupportDbComponent, DeviceSupportEntry, BulkUpsertEntry } from '../../src/adapters/device-support-db'
import { Decision } from '../../src/logic/device-support'

export function createTestDeviceSupportEntry(overrides: Partial<DeviceSupportEntry> = {}): DeviceSupportEntry {
  return {
    soc: 'MT6765',
    decision: 'exclude',
    updatedAt: '2026-09-29T00:00:00.000Z',
    updatedBy: null,
    ...overrides
  }
}

export const DEFAULT_TEST_ENTRIES: DeviceSupportEntry[] = [
  createTestDeviceSupportEntry({ soc: 'MT6765', decision: 'exclude' }),
  createTestDeviceSupportEntry({ soc: 'SM4350', decision: 'below-minspec' })
]

// For unit tests - uses jest mocks
export function createDeviceSupportDbJestMockComponent(
  overrides: Partial<jest.Mocked<IDeviceSupportDbComponent>> = {}
): jest.Mocked<IDeviceSupportDbComponent> {
  return {
    getDecision: jest.fn().mockResolvedValue('keep'),
    getAll: jest.fn().mockResolvedValue([...DEFAULT_TEST_ENTRIES]),
    upsert: jest.fn().mockImplementation((soc: string, decision: Decision, updatedBy: string) =>
      Promise.resolve(createTestDeviceSupportEntry({ soc: soc.toUpperCase(), decision, updatedBy }))
    ),
    bulkUpsert: jest.fn().mockImplementation((entries: BulkUpsertEntry[]) => Promise.resolve(entries.length)),
    delete: jest.fn().mockResolvedValue(true),
    ...overrides
  }
}
