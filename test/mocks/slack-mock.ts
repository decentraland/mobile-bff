import { AuthChain } from '@dcl/crypto'
import { ISlackComponent } from '../../src/adapters/slack'

// For unit tests - uses jest mocks
export function createSlackJestMockComponent(
  overrides: Partial<jest.Mocked<ISlackComponent>> = {}
): jest.Mocked<ISlackComponent> {
  return {
    sendDeletionRequestNotification: jest.fn().mockResolvedValue(undefined),
    sendCancellationNotification: jest.fn().mockResolvedValue(undefined),
    ...overrides
  }
}

// For integration tests - uses real async functions
export function createSlackMockComponent(): ISlackComponent {
  return {
    sendDeletionRequestNotification: async (_userAddress: string, _authChain: AuthChain): Promise<void> => {},
    sendCancellationNotification: async (_userAddress: string, _authChain: AuthChain): Promise<void> => {}
  }
}
