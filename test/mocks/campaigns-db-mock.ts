import {
  ICampaignsDbComponent,
  Campaign,
  PublicCampaignsMap,
  CreateCampaignInput,
  UpdateCampaignInput
} from '../../src/adapters/campaigns-db'

export const DEFAULT_TEST_CAMPAIGNS: PublicCampaignsMap = {
  'summer-26': {
    mode: 'ftue',
    target: { type: 'genesis', position: '-9,-9' },
    title: 'Summer is here',
    cta: 'Jump into Summer',
    placeIds: []
  },
  'world-launch': {
    mode: 'bypass',
    target: { type: 'world', name: 'myworld.dcl.eth' },
    title: null,
    cta: null,
    placeIds: []
  }
}

export function createTestCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    token: 'summer-26',
    mode: 'ftue',
    target: { type: 'genesis', position: '-9,-9' },
    title: 'Summer is here',
    cta: 'Jump into Summer',
    placeIds: [],
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
        mode: input.mode,
        target: input.targetType === 'world'
          ? { type: 'world', name: input.targetWorld as string }
          : { type: 'genesis', position: input.targetPosition as string },
        title: input.title,
        cta: input.cta,
        placeIds: input.placeIds,
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
        ...(changes.mode !== undefined ? { mode: changes.mode } : {}),
        ...(changes.enabled !== undefined ? { enabled: changes.enabled } : {})
      }))
    ),
    delete: jest.fn().mockResolvedValue(true),
    getAudit: jest.fn().mockResolvedValue([]),
    ...overrides
  }
}
