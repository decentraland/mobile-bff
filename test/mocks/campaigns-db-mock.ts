import {
  ICampaignsDbComponent,
  Campaign,
  PublicCampaignsMap,
  CreateCampaignInput,
  UpdateCampaignInput
} from '../../src/adapters/campaigns-db'

export const DEFAULT_TEST_CAMPAIGNS: PublicCampaignsMap = {
  'summer-26': { target: { type: 'genesis', position: '-9,-9' } },
  'world-launch': { target: { type: 'world', name: 'myworld.dcl.eth' } }
}

function toTarget(input: CreateCampaignInput | UpdateCampaignInput): Campaign['target'] {
  return input.targetType === 'world'
    ? { type: 'world', name: input.targetWorld as string }
    : { type: 'genesis', position: input.targetPosition as string }
}

export function createTestCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    token: 'summer-26',
    target: { type: 'genesis', position: '-9,-9' },
    ...overrides
  }
}

export function createCampaignsDbJestMockComponent(
  overrides: Partial<jest.Mocked<ICampaignsDbComponent>> = {}
): jest.Mocked<ICampaignsDbComponent> {
  return {
    getMap: jest.fn().mockResolvedValue({ ...DEFAULT_TEST_CAMPAIGNS }),
    getAll: jest.fn().mockResolvedValue([createTestCampaign()]),
    getByToken: jest.fn().mockImplementation((token: string) =>
      Promise.resolve(createTestCampaign({ token }))
    ),
    create: jest.fn().mockImplementation((input: CreateCampaignInput) =>
      Promise.resolve(createTestCampaign({ token: input.token, target: toTarget(input) }))
    ),
    update: jest.fn().mockImplementation((token: string, changes: UpdateCampaignInput) =>
      Promise.resolve(createTestCampaign({ token, target: toTarget(changes) }))
    ),
    delete: jest.fn().mockResolvedValue(true),
    ...overrides
  }
}
