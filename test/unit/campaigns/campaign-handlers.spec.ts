import { getCampaignsHandler } from '../../../src/controllers/handlers/campaigns/get-campaigns-handler'
import { getBackofficeCampaignsHandler } from '../../../src/controllers/handlers/backoffice/campaigns/get-campaigns-handler'
import { createCampaignHandler } from '../../../src/controllers/handlers/backoffice/campaigns/create-campaign-handler'
import { updateCampaignHandler } from '../../../src/controllers/handlers/backoffice/campaigns/update-campaign-handler'
import { deleteCampaignHandler } from '../../../src/controllers/handlers/backoffice/campaigns/delete-campaign-handler'
import { getCampaignAuditHandler } from '../../../src/controllers/handlers/backoffice/campaigns/get-campaign-audit-handler'
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

  function createContext(auth: string | undefined, body?: any, params?: any, url?: string) {
    return {
      components: { campaignsDb: mockCampaignsDb, logs: mockLogs, config: mockConfig },
      verification: auth ? { auth } : undefined,
      request: { json: () => Promise.resolve(body) },
      params: params ?? {},
      url: new URL(url ?? 'http://localhost/backoffice/campaigns')
    }
  }

  describe('public GET /campaigns', () => {
    it('returns the active campaign map keyed by token', async () => {
      const response = await getCampaignsHandler(createContext(undefined) as any)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ ok: true, data: { campaigns: DEFAULT_TEST_CAMPAIGNS } })
      expect(mockCampaignsDb.getActive).toHaveBeenCalled()
    })

    // The client fails open to the default FTUE, so a db outage must stay a clean
    // 5xx envelope rather than leaking an exception shape.
    it('returns the error envelope when the db fails', async () => {
      mockCampaignsDb.getActive.mockRejectedValue(new Error('db down'))

      const response = await getCampaignsHandler(createContext(undefined) as any)

      expect(response.status).toBe(500)
      expect(response.body).toEqual({ ok: false, error: 'Internal server error' })
    })
  })

  // The backoffice UI reads these envelopes directly, so their shape is part of the contract.
  describe('backoffice list envelopes', () => {
    it('wraps the campaign list under data.campaigns', async () => {
      const response = await getBackofficeCampaignsHandler(createContext(ALLOWED) as any)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ ok: true, data: { campaigns: [createTestCampaign()] } })
    })

    it('wraps the audit trail under data.entries', async () => {
      const response = await getCampaignAuditHandler(
        createContext(ALLOWED, undefined, { token: 'summer-26' }) as any
      )

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ ok: true, data: { entries: [] } })
    })
  })

  describe('backoffice auth gate', () => {
    it.each([
      ['list', getBackofficeCampaignsHandler],
      ['create', createCampaignHandler],
      ['update', updateCampaignHandler],
      ['delete', deleteCampaignHandler],
      ['audit', getCampaignAuditHandler]
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
    it('stores the canonical target triple and defaults to a disabled ftue campaign', async () => {
      const response = await createCampaignHandler(
        createContext(ALLOWED, { token: 'summer-26', targetType: 'genesis', targetPosition: '-9,-9' }) as any
      )

      expect(response.status).toBe(201)
      expect(mockCampaignsDb.create).toHaveBeenCalledWith(
        {
          token: 'summer-26',
          mode: 'ftue',
          targetType: 'genesis',
          targetPosition: '-9,-9',
          targetWorld: null,
          title: null,
          cta: null,
          placeIds: [],
          startsAt: null,
          endsAt: null,
          // Absent `enabled` defaults to dark, so a campaign cannot go live by omission.
          enabled: false
        },
        ALLOWED
      )
    })

    it('accepts a bypass campaign targeting a world, with an active window', async () => {
      const response = await createCampaignHandler(
        createContext(ALLOWED, {
          token: 'world-launch',
          mode: 'bypass',
          targetType: 'world',
          targetWorld: 'myworld.dcl.eth',
          startsAt: '2026-09-01T00:00:00.000Z',
          endsAt: '2026-09-30T00:00:00.000Z',
          enabled: true
        }) as any
      )

      expect(response.status).toBe(201)
      expect(mockCampaignsDb.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'bypass',
          targetType: 'world',
          targetWorld: 'myworld.dcl.eth',
          targetPosition: null,
          startsAt: new Date('2026-09-01T00:00:00.000Z'),
          endsAt: new Date('2026-09-30T00:00:00.000Z'),
          enabled: true
        }),
        ALLOWED
      )
    })

    it.each([
      ['a non-kebab token', { token: 'Summer 26', targetType: 'genesis', targetPosition: '0,0' }],
      ['an unknown mode', { token: 'x', mode: 'skip', targetType: 'genesis', targetPosition: '0,0' }],
      ['a missing target', { token: 'x' }],
      ['a malformed parcel', { token: 'x', targetType: 'genesis', targetPosition: 'a,b' }],
      ['an unroutable world', { token: 'x', targetType: 'world', targetWorld: 'my-world.dcl.eth' }],
      ['an inverted window', {
        token: 'x', targetType: 'genesis', targetPosition: '0,0',
        startsAt: '2026-09-30T00:00:00.000Z', endsAt: '2026-09-01T00:00:00.000Z'
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
      expect(response.body.error).toContain('summer-26')
    })
  })

  describe('PUT /backoffice/campaigns/:token', () => {
    it('applies a partial change', async () => {
      const response = await updateCampaignHandler(
        createContext(ALLOWED, { enabled: true }, { token: 'summer-26' }) as any
      )

      expect(response.status).toBe(200)
      expect(mockCampaignsDb.update).toHaveBeenCalledWith('summer-26', { enabled: true }, ALLOWED)
    })

    // The three target columns are constrained as a unit, so a half-target edit is
    // rejected instead of being merged with the stored row.
    it('rejects a partial target edit', async () => {
      const response = await updateCampaignHandler(
        createContext(ALLOWED, { targetPosition: '10,10' }, { token: 'summer-26' }) as any
      )

      expect(response.status).toBe(400)
      expect(mockCampaignsDb.update).not.toHaveBeenCalled()
    })

    it('validates a one-sided window edit against the stored bound', async () => {
      mockCampaignsDb.getByToken.mockResolvedValue(
        createTestCampaign({ startsAt: '2026-09-15T00:00:00.000Z' })
      )

      const response = await updateCampaignHandler(
        createContext(ALLOWED, { endsAt: '2026-09-01T00:00:00.000Z' }, { token: 'summer-26' }) as any
      )

      expect(response.status).toBe(400)
      expect(response.body.error).toMatch(/must be after/)
      expect(mockCampaignsDb.update).not.toHaveBeenCalled()
    })

    it('returns 404 for an unknown token', async () => {
      mockCampaignsDb.getByToken.mockResolvedValue(null)

      const response = await updateCampaignHandler(
        createContext(ALLOWED, { enabled: true }, { token: 'ghost' }) as any
      )

      expect(response.status).toBe(404)
      expect(mockCampaignsDb.update).not.toHaveBeenCalled()
    })

    // `placeIds: null` used to validate a substitute and then store the original, which is a
    // NOT NULL violation — a bad request surfacing as a 500.
    it('treats a null placeIds as clearing the carousel', async () => {
      const response = await updateCampaignHandler(
        createContext(ALLOWED, { placeIds: null }, { token: 'summer-26' }) as any
      )

      expect(response.status).toBe(200)
      expect(mockCampaignsDb.update).toHaveBeenCalledWith('summer-26', { placeIds: [] }, ALLOWED)
    })

    it('returns 400 when the body carries nothing to update', async () => {
      const response = await updateCampaignHandler(
        createContext(ALLOWED, {}, { token: 'summer-26' }) as any
      )

      expect(response.status).toBe(400)
      expect(mockCampaignsDb.update).not.toHaveBeenCalled()
    })
  })

  describe('DELETE /backoffice/campaigns/:token', () => {
    it('deletes an existing campaign and 404s an unknown one', async () => {
      const deleted = await deleteCampaignHandler(
        createContext(ALLOWED, undefined, { token: 'summer-26' }) as any
      )
      expect(deleted.status).toBe(200)
      expect(mockCampaignsDb.delete).toHaveBeenCalledWith('summer-26', ALLOWED)

      mockCampaignsDb.delete.mockResolvedValue(false)
      const missing = await deleteCampaignHandler(
        createContext(ALLOWED, undefined, { token: 'ghost' }) as any
      )
      expect(missing.status).toBe(404)
    })
  })

  describe('GET /backoffice/campaigns/:token/audit', () => {
    it('clamps the limit and answers for a token that no longer exists', async () => {
      const response = await getCampaignAuditHandler(
        createContext(
          ALLOWED,
          undefined,
          { token: 'deleted-campaign' },
          'http://localhost/backoffice/campaigns/deleted-campaign/audit?limit=9999'
        ) as any
      )

      expect(response.status).toBe(200)
      expect(mockCampaignsDb.getAudit).toHaveBeenCalledWith('deleted-campaign', 200)
    })

    it('falls back to the default limit when the query param is absent or junk', async () => {
      await getCampaignAuditHandler(
        createContext(ALLOWED, undefined, { token: 'summer-26' },
          'http://localhost/backoffice/campaigns/summer-26/audit') as any
      )
      expect(mockCampaignsDb.getAudit).toHaveBeenCalledWith('summer-26', 50)

      await getCampaignAuditHandler(
        createContext(ALLOWED, undefined, { token: 'summer-26' },
          'http://localhost/backoffice/campaigns/summer-26/audit?limit=abc') as any
      )
      expect(mockCampaignsDb.getAudit).toHaveBeenLastCalledWith('summer-26', 50)
    })
  })
})
