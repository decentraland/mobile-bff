import { IBansDbComponent, Ban, CreateGroupBanInput, CreateSceneBanInput, ParcelCoord } from '../../src/adapters/bans-db'

// For unit tests - uses jest mocks
export function createBansDbJestMockComponent(
  overrides: Partial<jest.Mocked<IBansDbComponent>> = {}
): jest.Mocked<IBansDbComponent> {
  return {
    getAllBans: jest.fn().mockResolvedValue([]),
    getBanById: jest.fn().mockResolvedValue(null),
    getBanByGroupId: jest.fn().mockResolvedValue(null),
    getBanByParcel: jest.fn().mockResolvedValue(null),
    getBanByWorldName: jest.fn().mockResolvedValue(null),
    createGroupBan: jest.fn().mockImplementation((input: CreateGroupBanInput, createdBy: string) =>
      Promise.resolve(createTestBan({
        groupId: input.groupId,
        parcels: [],
        reason: input.reason,
        createdBy
      }))
    ),
    createSceneBan: jest.fn().mockImplementation((input: CreateSceneBanInput, createdBy: string) =>
      Promise.resolve(createTestBan({
        groupId: null,
        parcels: input.parcels,
        reason: input.reason,
        createdBy
      }))
    ),
    createWorldBan: jest.fn().mockImplementation((input: any, createdBy: string) =>
      Promise.resolve(createTestBan({
        groupId: null,
        worldName: input.worldName,
        parcels: [],
        sceneId: input.sceneId || null,
        reason: input.reason,
        createdBy
      }))
    ),
    deleteBan: jest.fn().mockResolvedValue(false),
    ...overrides
  }
}

// For integration tests - uses stateful mock
export function createBansDbMockComponent(): IBansDbComponent & {
  _setGetAllBansResult: (result: Ban[]) => void
  _setGetBanByIdResult: (result: Ban | null) => void
  _setGetBanByGroupIdResult: (result: Ban | null) => void
  _setGetBanByParcelResult: (result: Ban | null) => void
  _setGetBanByWorldNameResult: (result: Ban | null) => void
  _setCreateGroupBanResult: (result: Ban) => void
  _setCreateSceneBanResult: (result: Ban) => void
  _setCreateWorldBanResult: (result: Ban) => void
  _setDeleteBanResult: (result: boolean) => void
} {
  let getAllBansResult: Ban[] = []
  let getBanByIdResult: Ban | null = null
  let getBanByGroupIdResult: Ban | null = null
  let getBanByParcelResult: Ban | null = null
  let getBanByWorldNameResult: Ban | null = null
  let createGroupBanResult: Ban | null = null
  let createSceneBanResult: Ban | null = null
  let createWorldBanResult: Ban | null = null
  let deleteBanResult: boolean = false

  return {
    getAllBans: async () => getAllBansResult,
    getBanById: async () => getBanByIdResult,
    getBanByGroupId: async () => getBanByGroupIdResult,
    getBanByParcel: async () => getBanByParcelResult,
    getBanByWorldName: async () => getBanByWorldNameResult,
    createGroupBan: async (input: CreateGroupBanInput, createdBy: string) => {
      if (createGroupBanResult) return createGroupBanResult
      return createTestBan({
        groupId: input.groupId,
        parcels: [],
        reason: input.reason,
        createdBy
      })
    },
    createSceneBan: async (input: CreateSceneBanInput, createdBy: string) => {
      if (createSceneBanResult) return createSceneBanResult
      return createTestBan({
        groupId: null,
        parcels: input.parcels,
        reason: input.reason,
        createdBy
      })
    },
    createWorldBan: async (input: any, createdBy: string) => {
      if (createWorldBanResult) return createWorldBanResult
      return createTestBan({
        groupId: null,
        worldName: input.worldName,
        parcels: [],
        sceneId: input.sceneId || null,
        reason: input.reason,
        createdBy
      })
    },
    deleteBan: async () => deleteBanResult,
    _setGetAllBansResult: (result) => { getAllBansResult = result },
    _setGetBanByIdResult: (result) => { getBanByIdResult = result },
    _setGetBanByGroupIdResult: (result) => { getBanByGroupIdResult = result },
    _setGetBanByParcelResult: (result) => { getBanByParcelResult = result },
    _setGetBanByWorldNameResult: (result) => { getBanByWorldNameResult = result },
    _setCreateGroupBanResult: (result) => { createGroupBanResult = result },
    _setCreateSceneBanResult: (result) => { createSceneBanResult = result },
    _setCreateWorldBanResult: (result) => { createWorldBanResult = result },
    _setDeleteBanResult: (result) => { deleteBanResult = result }
  }
}

export function createTestBan(overrides: Partial<Ban> = {}): Ban {
  return {
    id: 'test-ban-uuid-123',
    groupId: null,
    worldName: null,
    parcels: [{ x: 0, y: 0 }],
    sceneId: null,
    reason: 'Test reason',
    createdBy: '0x1234567890123456789012345678901234567890',
    createdAt: Date.now(),
    ...overrides
  }
}

export function createTestGroupBan(groupId: string, overrides: Partial<Ban> = {}): Ban {
  return createTestBan({
    groupId,
    parcels: [],
    ...overrides
  })
}

export function createTestSceneBan(parcels: ParcelCoord[], overrides: Partial<Ban> = {}): Ban {
  return createTestBan({
    groupId: null,
    parcels,
    ...overrides
  })
}
