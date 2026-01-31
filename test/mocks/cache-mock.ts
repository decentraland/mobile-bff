import { ICacheComponent } from '../../src/adapters/cache'

export function createCacheMockComponent(): jest.Mocked<ICacheComponent> {
  return {
    get: jest.fn(),
    set: jest.fn(),
    invalidate: jest.fn(),
    clear: jest.fn()
  }
}
