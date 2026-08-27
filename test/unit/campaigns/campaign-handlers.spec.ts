import { getCampaignsHandler } from '../../../src/controllers/handlers/campaigns/get-campaigns-handler'
import { getBackofficeCampaignsHandler } from '../../../src/controllers/handlers/backoffice/campaigns/get-campaigns-handler'
import { createCampaignHandler } from '../../../src/controllers/handlers/backoffice/campaigns/create-campaign-handler'
import { updateCampaignHandler } from '../../../src/controllers/handlers/backoffice/campaigns/update-campaign-handler'
import { deleteCampaignHandler } from '../../../src/controllers/handlers/backoffice/campaigns/delete-campaign-handler'
import {
  createCampaignsDbJestMockComponent,
  createTestCampaign,
  DEFAULT_TEST_CAMPAIGNS
} from '../../mocks/campaigns-db-mock'
import { createLogsMockComponent } from '../../mocks/logs-mock'
import { createConfigJestMockComponent } from '../../mocks/config-mock'

describe('campaign handlers', () => {
  const OUTSIDER = '0x1234567890123456789012345678901234567890'
  const ALLOWED = '0xABCDEF1234567890123456789012345678901234'

  let mockCampaignsDb: ReturnType<typeof createCampaignsDbJestMockComponent>
  let mockLogs: ReturnType<typeof createLogsMockComponent>
  let mockConfig: ReturnType<typeof createConfigJestMockComponent>

  beforeEach(() => {
    mockCampaignsDb = createCampaignsDbJestMockComponent()
    mockLogs = createLogsMockComponent()
    mockConfig = createConfigJestMockComponent({ ALLOWED_USERS: ALLOWED })
  })

  function createContext(auth: string | undefined, body?: any, params?: any) {
    return {
      components: { campaignsDb: mockCampaignsDb, logs: mockLogs, config: mockConfig },
      verification: auth ? { auth } : undefined,
      request: { json: () => Promise.resolve(body) },
      params: params ?? {}
    }
  }

  describe('public GET /campaigns', () => {
    it('returns the campaign map keyed by token', async () => {
      const response = await getCampaignsHandler(createContext(undefined) as any)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ ok: true, data: { campaigns: DEFAULT_TEST_CAMPAIGNS } })
      expect(mockCampaignsDb.getMap).toHaveBeenCalled()
    })

    // The client fails open to the default FTUE, so a db outage must stay a clean
    // 5xx envelope rather than leaking an exception shape.
    it('returns the error envelope when the db fails', async () => {
      mockCampaignsDb.getMap.mockRejectedValue(new Error('db down'))

      const response = await getCampaignsHandler(createContext(undefined) as any)

      expect(response.status).toBe(500)
      expect(response.body).toEqual({ ok: false, error: 'Internal server error' })
    })
  })

  // The backoffice UI reads this envelope directly, so its shape is part of the contract.
  it('wraps the backoffice campaign list under data.campaigns', async () => {
    const response = await getBackofficeCampaignsHandler(createContext(ALLOWED) as any)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ ok: true, data: { campaigns: [createTestCampaign()] } })
  })

  describe('backoffice auth gate', () => {
    it.each([
      ['list', getBackofficeCampaignsHandler],
      ['create', createCampaignHandler],
      ['update', updateCampaignHandler],
      ['delete', deleteCampaignHandler]
    ])('rejects unauthenticated and non-allowlisted callers on %s', async (_label, handler) => {
      const anonymous = await handler(createContext(undefined, {}, { token: 'summer-26' }) as any)
      expect(anonymous.status).toBe(401)

      const outsider = await handler(createContext(OUTSIDER, {}, { token: 'summer-26' }) as any)
      expect(outsider.status).toBe(403)

      expect(mockCampaignsDb.create).not.toHaveBeenCalled()
      expect(mockCampaignsDb.update).not.toHaveBeenCalled()
      expect(mockCampaignsDb.delete).not.toHaveBeenCalled()
    })
  })

  describe('POST /backoffice/campaigns', () => {
    it('stores the canonical target triple for a genesis target', async () => {
      const response = await createCampaignHandler(
        createContext(ALLOWED, {
          token: 'summer2022',
          targetType: 'genesis',
          targetPosition: '10,-20'
        }) as any
      )

      expect(response.status).toBe(201)
      expect(mockCampaignsDb.create).toHaveBeenCalledWith({
        token: 'summer2022',
        targetType: 'genesis',
        targetPosition: '10,-20',
        targetWorld: null
      })
    })

    it('stores the canonical target triple for a world target', async () => {
      const response = await createCampaignHandler(
        createContext(ALLOWED, {
          token: 'world-launch',
          targetType: 'world',
          targetWorld: 'myworld.dcl.eth'
        }) as any
      )

      expect(response.status).toBe(201)
      expect(mockCampaignsDb.create).toHaveBeenCalledWith({
        token: 'world-launch',
        targetType: 'world',
        targetPosition: null,
        targetWorld: 'myworld.dcl.eth'
      })
    })

    it.each([
      ['a token that is not kebab-case', { token: 'Summer 26', targetType: 'genesis', targetPosition: '0,0' }],
      ['a world name the client could not resolve', { token: 'x', targetType: 'world', targetWorld: 'myworld.eth' }],
      ['a target mixing both column families', {
        token: 'x',
        targetType: 'genesis',
        targetPosition: '0,0',
        targetWorld: 'myworld.dcl.eth'
      }]
    ])('rejects %s without touching the db', async (_label, body) => {
      const response = await createCampaignHandler(createContext(ALLOWED, body) as any)

      expect(response.status).toBe(400)
      expect(mockCampaignsDb.create).not.toHaveBeenCalled()
    })

    it('maps a duplicate token to 409', async () => {
      mockCampaignsDb.create.mockRejectedValue(Object.assign(new Error('dup'), { code: '23505' }))

      const response = await createCampaignHandler(
        createContext(ALLOWED, { token: 'summer-26', targetType: 'genesis', targetPosition: '0,0' }) as any
      )

      expect(response.status).toBe(409)
    })
  })

  describe('PUT /backoffice/campaigns/:token', () => {
    it('replaces the target as a unit', async () => {
      const response = await updateCampaignHandler(
        createContext(
          ALLOWED,
          { targetType: 'world', targetWorld: 'other.dcl.eth' },
          { token: 'summer-26' }
        ) as any
      )

      expect(response.status).toBe(200)
      expect(mockCampaignsDb.update).toHaveBeenCalledWith('summer-26', {
        targetType: 'world',
        targetPosition: null,
        targetWorld: 'other.dcl.eth'
      })
    })

    // The three target columns are constrained together, so half a target cannot be
    // validated on its own — it has to be rejected rather than merged with the stored row.
    it('rejects a partial target edit', async () => {
      const response = await updateCampaignHandler(
        createContext(ALLOWED, { targetPosition: '5,5' }, { token: 'summer-26' }) as any
      )

      expect(response.status).toBe(400)
      expect(mockCampaignsDb.update).not.toHaveBeenCalled()
    })

    it('returns 404 for an unknown token', async () => {
      mockCampaignsDb.update.mockResolvedValue(null)

      const response = await updateCampaignHandler(
        createContext(ALLOWED, { targetType: 'genesis', targetPosition: '0,0' }, { token: 'nope' }) as any
      )

      expect(response.status).toBe(404)
    })
  })

  it('deletes an existing campaign and 404s an unknown one', async () => {
    const deleted = await deleteCampaignHandler(
      createContext(ALLOWED, undefined, { token: 'summer-26' }) as any
    )
    expect(deleted.status).toBe(200)
    expect(mockCampaignsDb.delete).toHaveBeenCalledWith('summer-26')

    mockCampaignsDb.delete.mockResolvedValue(false)
    const missing = await deleteCampaignHandler(
      createContext(ALLOWED, undefined, { token: 'nope' }) as any
    )
    expect(missing.status).toBe(404)
  })
})
