import { IDbComponent, DeletionRequest } from '../../src/adapters/db'

// For unit tests - uses jest mocks
export function createDbJestMockComponent(
  overrides: Partial<jest.Mocked<IDbComponent>> = {}
): jest.Mocked<IDbComponent> {
  return {
    getDeletionRequest: jest.fn().mockResolvedValue(null),
    createDeletionRequest: jest.fn().mockImplementation((userAddress: string) =>
      Promise.resolve({
        id: 1,
        userAddress: userAddress.toLowerCase(),
        requestedAt: new Date(),
        cancelledAt: null,
        status: 'pending'
      } as DeletionRequest)
    ),
    cancelDeletionRequest: jest.fn().mockResolvedValue(null),
    ...overrides
  }
}

// For integration tests - uses stateful mock
export function createDbMockComponent(): IDbComponent & {
  _setGetDeletionRequestResult: (result: DeletionRequest | null) => void
  _setCreateDeletionRequestResult: (result: DeletionRequest) => void
  _setCancelDeletionRequestResult: (result: DeletionRequest | null) => void
} {
  let getDeletionRequestResult: DeletionRequest | null = null
  let createDeletionRequestResult: DeletionRequest | null = null
  let cancelDeletionRequestResult: DeletionRequest | null = null

  return {
    getDeletionRequest: async (_userAddress: string): Promise<DeletionRequest | null> => {
      return getDeletionRequestResult
    },
    createDeletionRequest: async (userAddress: string): Promise<DeletionRequest> => {
      if (createDeletionRequestResult) {
        return createDeletionRequestResult
      }
      return {
        id: 1,
        userAddress: userAddress.toLowerCase(),
        requestedAt: new Date(),
        cancelledAt: null,
        status: 'pending'
      }
    },
    cancelDeletionRequest: async (_userAddress: string): Promise<DeletionRequest | null> => {
      return cancelDeletionRequestResult
    },
    _setGetDeletionRequestResult: (result: DeletionRequest | null) => {
      getDeletionRequestResult = result
    },
    _setCreateDeletionRequestResult: (result: DeletionRequest) => {
      createDeletionRequestResult = result
    },
    _setCancelDeletionRequestResult: (result: DeletionRequest | null) => {
      cancelDeletionRequestResult = result
    }
  }
}

export function createTestDeletionRequest(overrides: Partial<DeletionRequest> = {}): DeletionRequest {
  return {
    id: 1,
    userAddress: '0x1234567890123456789012345678901234567890',
    requestedAt: new Date('2024-01-01T00:00:00Z'),
    cancelledAt: null,
    status: 'pending',
    ...overrides
  }
}
