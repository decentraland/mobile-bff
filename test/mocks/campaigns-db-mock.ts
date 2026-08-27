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

export function createTestCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    token: 'summer-26',
    target: { type: 'genesis', position: '-9,-9' },
    startsAt: null,
    endsAt: null,
    enabled: true,
    createdAt: '2026-08-25T00:00:00.000Z',
    updatedAt: '2026-08-25T00:00:00.000Z',
    updatedBy: null,
    ...overrides
  }
}

export function createCampaignsDbJestMockComponent(
  overrides: Partial<jest.Mocked<ICampaignsDbComponent>> = {}
): jest.Mocked<ICampaignsDbComponent> {
  return {
    getActive: jest.fn().mockResolvedValue({ ...DEFAULT_TEST_CAMPAIGNS }),
    getAll: jest.fn().mockResolvedValue([createTestCampaign()]),
    getByToken: jest.fn().mockImplementation((token: string) =>
      Promise.resolve(createTestCampaign({ token }))
    ),
    create: jest.fn().mockImplementation((input: CreateCampaignInput, actor: string) =>
      Promise.resolve(createTestCampaign({
        token: input.token,
        target: input.targetType === 'world'
          ? { type: 'world', name: input.targetWorld as string }
          : { type: 'genesis', position: input.targetPosition as string },
        startsAt: input.startsAt ? input.startsAt.toISOString() : null,
        endsAt: input.endsAt ? input.endsAt.toISOString() : null,
        enabled: input.enabled,
        updatedBy: actor
      }))
    ),
    update: jest.fn().mockImplementation((token: string, changes: UpdateCampaignInput, actor: string) =>
      Promise.resolve(createTestCampaign({
        token,
        updatedBy: actor,
        ...(changes.enabled !== undefined ? { enabled: changes.enabled } : {})
      }))
    ),
    delete: jest.fn().mockResolvedValue(true),
    getAudit: jest.fn().mockResolvedValue([]),
    ...overrides
  }
}
