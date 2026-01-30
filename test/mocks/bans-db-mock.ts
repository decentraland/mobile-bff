import { IBansDbComponent, Ban, CreateGroupBanInput, CreateSceneBanInput, CreatePlaceBanInput } from '../../src/adapters/bans-db'

// For unit tests - uses jest mocks
export function createBansDbJestMockComponent(
  overrides: Partial<jest.Mocked<IBansDbComponent>> = {}
): jest.Mocked<IBansDbComponent> {
  return {
    getAllBans: jest.fn().mockResolvedValue([]),
    getBanById: jest.fn().mockResolvedValue(null),
    getBanByGroupId: jest.fn().mockResolvedValue(null),
    getBanByPosition: jest.fn().mockResolvedValue(null),
    getBanByWorldName: jest.fn().mockResolvedValue(null),
    getBanByPlaceId: jest.fn().mockResolvedValue(null),
    createGroupBan: jest.fn().mockImplementation((input: CreateGroupBanInput, createdBy: string) =>
      Promise.resolve(createTestBan({
        groupId: input.groupId,
        positions: [],
        reason: input.reason,
        createdBy
      }))
    ),
    createSceneBan: jest.fn().mockImplementation((input: CreateSceneBanInput, createdBy: string) =>
      Promise.resolve(createTestBan({
        groupId: null,
        positions: input.positions,
        reason: input.reason,
        createdBy
      }))
    ),
    createWorldBan: jest.fn().mockImplementation((input: any, createdBy: string) =>
      Promise.resolve(createTestBan({
        groupId: null,
        worldName: input.worldName,
        positions: [],
        sceneId: input.sceneId || null,
        reason: input.reason,
        createdBy
      }))
    ),
    createPlaceBan: jest.fn().mockImplementation((input: CreatePlaceBanInput, createdBy: string) =>
      Promise.resolve(createTestBan({
        placeId: input.placeId,
        positions: [],
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
  _setGetBanByPositionResult: (result: Ban | null) => void
  _setGetBanByWorldNameResult: (result: Ban | null) => void
  _setGetBanByPlaceIdResult: (result: Ban | null) => void
  _setCreateGroupBanResult: (result: Ban) => void
  _setCreateSceneBanResult: (result: Ban) => void
  _setCreateWorldBanResult: (result: Ban) => void
  _setCreatePlaceBanResult: (result: Ban) => void
  _setDeleteBanResult: (result: boolean) => void
} {
  let getAllBansResult: Ban[] = []
  let getBanByIdResult: Ban | null = null
  let getBanByGroupIdResult: Ban | null = null
  let getBanByPositionResult: Ban | null = null
  let getBanByWorldNameResult: Ban | null = null
  let getBanByPlaceIdResult: Ban | null = null
  let createGroupBanResult: Ban | null = null
  let createSceneBanResult: Ban | null = null
  let createWorldBanResult: Ban | null = null
  let createPlaceBanResult: Ban | null = null
  let deleteBanResult: boolean = false

  return {
    getAllBans: async () => getAllBansResult,
    getBanById: async () => getBanByIdResult,
    getBanByGroupId: async () => getBanByGroupIdResult,
    getBanByPosition: async () => getBanByPositionResult,
    getBanByWorldName: async () => getBanByWorldNameResult,
    getBanByPlaceId: async () => getBanByPlaceIdResult,
    createGroupBan: async (input: CreateGroupBanInput, createdBy: string) => {
      if (createGroupBanResult) return createGroupBanResult
      return createTestBan({
        groupId: input.groupId,
        positions: [],
        reason: input.reason,
        createdBy
      })
    },
    createSceneBan: async (input: CreateSceneBanInput, createdBy: string) => {
      if (createSceneBanResult) return createSceneBanResult
      return createTestBan({
        groupId: null,
        positions: input.positions,
        reason: input.reason,
        createdBy
      })
    },
    createWorldBan: async (input: any, createdBy: string) => {
      if (createWorldBanResult) return createWorldBanResult
      return createTestBan({
        groupId: null,
        worldName: input.worldName,
        positions: [],
        sceneId: input.sceneId || null,
        reason: input.reason,
        createdBy
      })
    },
    createPlaceBan: async (input: CreatePlaceBanInput, createdBy: string) => {
      if (createPlaceBanResult) return createPlaceBanResult
      return createTestBan({
        placeId: input.placeId,
        positions: [],
        sceneId: input.sceneId || null,
        reason: input.reason,
        createdBy
      })
    },
    deleteBan: async () => deleteBanResult,
    _setGetAllBansResult: (result) => { getAllBansResult = result },
    _setGetBanByIdResult: (result) => { getBanByIdResult = result },
    _setGetBanByGroupIdResult: (result) => { getBanByGroupIdResult = result },
    _setGetBanByPositionResult: (result) => { getBanByPositionResult = result },
    _setGetBanByWorldNameResult: (result) => { getBanByWorldNameResult = result },
    _setGetBanByPlaceIdResult: (result) => { getBanByPlaceIdResult = result },
    _setCreateGroupBanResult: (result) => { createGroupBanResult = result },
    _setCreateSceneBanResult: (result) => { createSceneBanResult = result },
    _setCreateWorldBanResult: (result) => { createWorldBanResult = result },
    _setCreatePlaceBanResult: (result) => { createPlaceBanResult = result },
    _setDeleteBanResult: (result) => { deleteBanResult = result }
  }
}

export function createTestBan(overrides: Partial<Ban> = {}): Ban {
  return {
    id: 'test-ban-uuid-123',
    groupId: null,
    worldName: null,
    placeId: null,
    positions: ['0,0'],
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
    positions: [],
    ...overrides
  })
}

export function createTestSceneBan(positions: string[], overrides: Partial<Ban> = {}): Ban {
  return createTestBan({
    groupId: null,
    positions,
    ...overrides
  })
}
