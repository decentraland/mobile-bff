import { ISceneGroupsDbComponent, SceneGroup, CreateSceneGroupInput } from '../../src/adapters/scene-groups-db'

// For unit tests - uses jest mocks
export function createSceneGroupsDbJestMockComponent(
  overrides: Partial<jest.Mocked<ISceneGroupsDbComponent>> = {}
): jest.Mocked<ISceneGroupsDbComponent> {
  return {
    getAllSceneGroups: jest.fn().mockResolvedValue([]),
    getSceneGroupById: jest.fn().mockResolvedValue(null),
    getSceneGroupByParcel: jest.fn().mockResolvedValue(null),
    createSceneGroup: jest.fn().mockImplementation((input: CreateSceneGroupInput) =>
      Promise.resolve(createTestSceneGroup({
        name: input.name,
        description: input.description || '',
        color: input.color,
        tags: input.tags || [],
        parcels: input.parcels
      }))
    ),
    updateSceneGroup: jest.fn().mockResolvedValue(null),
    deleteSceneGroup: jest.fn().mockResolvedValue(false),
    ...overrides
  }
}

// For integration tests - uses stateful mock
export function createSceneGroupsDbMockComponent(): ISceneGroupsDbComponent & {
  _setGetAllSceneGroupsResult: (result: SceneGroup[]) => void
  _setGetSceneGroupByIdResult: (result: SceneGroup | null) => void
  _setGetSceneGroupByParcelResult: (result: SceneGroup | null) => void
  _setCreateSceneGroupResult: (result: SceneGroup) => void
  _setUpdateSceneGroupResult: (result: SceneGroup | null) => void
  _setDeleteSceneGroupResult: (result: boolean) => void
} {
  let getAllSceneGroupsResult: SceneGroup[] = []
  let getSceneGroupByIdResult: SceneGroup | null = null
  let getSceneGroupByParcelResult: SceneGroup | null = null
  let createSceneGroupResult: SceneGroup | null = null
  let updateSceneGroupResult: SceneGroup | null = null
  let deleteSceneGroupResult: boolean = false

  return {
    getAllSceneGroups: async () => getAllSceneGroupsResult,
    getSceneGroupById: async () => getSceneGroupByIdResult,
    getSceneGroupByParcel: async () => getSceneGroupByParcelResult,
    createSceneGroup: async (input: CreateSceneGroupInput) => {
      if (createSceneGroupResult) return createSceneGroupResult
      return createTestSceneGroup({
        name: input.name,
        description: input.description || '',
        color: input.color,
        tags: input.tags || [],
        parcels: input.parcels
      })
    },
    updateSceneGroup: async () => updateSceneGroupResult,
    deleteSceneGroup: async () => deleteSceneGroupResult,
    _setGetAllSceneGroupsResult: (result) => { getAllSceneGroupsResult = result },
    _setGetSceneGroupByIdResult: (result) => { getSceneGroupByIdResult = result },
    _setGetSceneGroupByParcelResult: (result) => { getSceneGroupByParcelResult = result },
    _setCreateSceneGroupResult: (result) => { createSceneGroupResult = result },
    _setUpdateSceneGroupResult: (result) => { updateSceneGroupResult = result },
    _setDeleteSceneGroupResult: (result) => { deleteSceneGroupResult = result }
  }
}

export function createTestSceneGroup(overrides: Partial<SceneGroup> = {}): SceneGroup {
  return {
    id: 'test-uuid-123',
    name: 'Test Group',
    description: 'Test description',
    color: '#FF6B6B',
    tags: ['test', 'example'],
    parcels: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides
  }
}
