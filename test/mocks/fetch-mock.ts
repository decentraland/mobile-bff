import type { IFetchComponent } from '@dcl/core-commons'

export function createFetchMockComponent(): jest.Mocked<IFetchComponent> {
  return {
    fetch: jest.fn()
  }
}

export function createMockResponse(body: any, ok = true, status = 200): any {
  return {
    ok,
    status,
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
    headers: new Headers(),
    redirected: false,
    statusText: ok ? 'OK' : 'Error',
    type: 'basic',
    url: '',
    clone: jest.fn(),
    body: null,
    bodyUsed: false,
    arrayBuffer: jest.fn(),
    blob: jest.fn(),
    formData: jest.fn(),
    bytes: jest.fn(),
    buffer: jest.fn(),
    size: 0,
    textConverted: jest.fn(),
    timeout: 0
  }
}
