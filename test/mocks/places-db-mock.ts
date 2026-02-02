import { Place, IPlacesDbComponent } from '../../src/adapters/places-db'

export function createPlacesDbMockComponent(): jest.Mocked<IPlacesDbComponent> {
  return {
    getAllPlaces: jest.fn(),
    getPlaceById: jest.fn(),
    getPlaceByBasePosition: jest.fn(),
    getPlaceByPosition: jest.fn(),
    getPlaceByWorldName: jest.fn(),
    getPlacesByGroupId: jest.fn(),
    createPlace: jest.fn(),
    updatePlace: jest.fn(),
    deletePlace: jest.fn(),
    setPlaceGroup: jest.fn()
  }
}

export function createTestPlace(overrides: Partial<Place> = {}): Place {
  return {
    id: 'test-place-id',
    type: 'scene',
    name: 'Test Place',
    basePosition: '0,0',
    worldName: null,
    sceneId: null,
    groupId: null,
    groupName: null,
    groupColor: null,
    tags: [],
    positions: ['0,0'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides
  }
}

export function createTestWorldPlace(overrides: Partial<Place> = {}): Place {
  return createTestPlace({
    type: 'world',
    basePosition: null,
    worldName: 'test-world.dcl.eth',
    positions: [],
    ...overrides
  })
}
