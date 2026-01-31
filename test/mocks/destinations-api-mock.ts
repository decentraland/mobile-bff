import { IDestinationsApiComponent, Destination, DestinationsResponse } from '../../src/adapters/destinations-api'

export function createDestinationsApiMockComponent(): jest.Mocked<IDestinationsApiComponent> {
  return {
    getForPlaces: jest.fn(),
    proxyQuery: jest.fn()
  }
}

export function createTestDestination(overrides: Partial<Destination> = {}): Destination {
  return {
    id: 'test-dest-id',
    title: 'Test Destination',
    base_position: '0,0',
    ...overrides
  }
}

export function createTestWorldDestination(overrides: Partial<Destination> = {}): Destination {
  return {
    id: 'test-world-dest-id',
    title: 'Test World Destination',
    world_name: 'test-world.dcl.eth',
    ...overrides
  }
}

export function createDestinationsResponse(data: Destination[], ok = true): DestinationsResponse {
  return { ok, data, total: data.length }
}
