import { updateFeatureFlagsHandler } from '../../../../src/controllers/handlers/backoffice/feature-flags/update-feature-flags-handler'
import { createFeatureFlagsDbJestMockComponent, DEFAULT_TEST_FLAGS } from '../../../mocks/feature-flags-db-mock'
import { createLogsMockComponent } from '../../../mocks/logs-mock'
import { createConfigJestMockComponent } from '../../../mocks/config-mock'

describe('update-feature-flags-handler', () => {
  const TEST_ADDRESS = '0x1234567890123456789012345678901234567890'
  const ALLOWED_ADDRESS = '0xABCDEF1234567890123456789012345678901234'

  let mockFeatureFlagsDb: ReturnType<typeof createFeatureFlagsDbJestMockComponent>
  let mockLogs: ReturnType<typeof createLogsMockComponent>
  let mockConfig: ReturnType<typeof createConfigJestMockComponent>

  beforeEach(() => {
    mockFeatureFlagsDb = createFeatureFlagsDbJestMockComponent()
    mockLogs = createLogsMockComponent()
    mockConfig = createConfigJestMockComponent({ ALLOWED_USERS: ALLOWED_ADDRESS })
  })

  function createContext(auth: string | undefined, body: any) {
    return {
      components: {
        featureFlagsDb: mockFeatureFlagsDb,
        logs: mockLogs,
        config: mockConfig
      },
      verification: auth ? { auth } : undefined,
      request: {
        json: () => Promise.resolve(body)
      }
    }
  }

  describe('when the request is not authenticated', () => {
    it('should return 401 Unauthorized', async () => {
      const context = createContext(undefined, { flags: { pulse: true } })
      const response = await updateFeatureFlagsHandler(context as any)

      expect(response.status).toBe(401)
      expect(response.body).toEqual({ ok: false, error: 'Unauthorized' })
    })
  })

  describe('when the user is not in ALLOWED_USERS', () => {
    it('should return 403 Forbidden', async () => {
      const context = createContext(TEST_ADDRESS, { flags: { pulse: true } })
      const response = await updateFeatureFlagsHandler(context as any)

      expect(response.status).toBe(403)
      expect(response.body).toEqual({ ok: false, error: 'Forbidden: User not in allowed list' })
    })
  })

  describe('when the user is allowed', () => {
    describe('and validation fails', () => {
      it.each([
        ['missing', {}],
        ['null', { flags: null }],
        ['not an object', { flags: 'pulse' }],
        ['an array', { flags: ['pulse'] }],
        ['empty', { flags: {} }]
      ])('should return 400 when flags is %s', async (_label, body) => {
        const context = createContext(ALLOWED_ADDRESS, body)
        const response = await updateFeatureFlagsHandler(context as any)

        expect(response.status).toBe(400)
        expect(response.body).toEqual({ ok: false, error: "'flags' must be a non-empty object" })
      })

      it.each([
        ['a string', 'true'],
        ['a number', 1],
        ['null', null]
      ])('should return 400 when a flag value is %s', async (_label, value) => {
        const context = createContext(ALLOWED_ADDRESS, { flags: { pulse: value } })
        const response = await updateFeatureFlagsHandler(context as any)

        expect(response.status).toBe(400)
        expect(response.body).toEqual({ ok: false, error: "Flag 'pulse' must be a boolean" })
      })

      it('should return 400 for an unknown flag name and not write anything', async () => {
        const context = createContext(ALLOWED_ADDRESS, { flags: { 'not-a-flag': true } })
        const response = await updateFeatureFlagsHandler(context as any)

        expect(response.status).toBe(400)
        expect(response.body).toEqual({ ok: false, error: "Unknown feature flag: 'not-a-flag'" })
        expect(mockFeatureFlagsDb.update).not.toHaveBeenCalled()
      })

      it('should return 400 for inherited object keys like toString', async () => {
        const context = createContext(ALLOWED_ADDRESS, { flags: { toString: true } })
        const response = await updateFeatureFlagsHandler(context as any)

        expect(response.status).toBe(400)
        expect(response.body).toEqual({ ok: false, error: "Unknown feature flag: 'toString'" })
        expect(mockFeatureFlagsDb.update).not.toHaveBeenCalled()
      })

      it("should return 400 for '__proto__' without reaching the db", async () => {
        // JSON.parse creates __proto__ as an own property, exactly like a real request body
        const context = createContext(ALLOWED_ADDRESS, JSON.parse('{"flags":{"__proto__":true}}'))
        const response = await updateFeatureFlagsHandler(context as any)

        expect(response.status).toBe(400)
        expect(response.body).toEqual({ ok: false, error: "Unknown feature flag: '__proto__'" })
        expect(mockFeatureFlagsDb.update).not.toHaveBeenCalled()
      })
    })

    describe('and the update is valid', () => {
      it('should return 200 with the full post-update flags map', async () => {
        const context = createContext(ALLOWED_ADDRESS, { flags: { pulse: true } })
        const response = await updateFeatureFlagsHandler(context as any)

        expect(response.status).toBe(200)
        expect(response.body).toEqual({ ok: true, data: { flags: { ...DEFAULT_TEST_FLAGS, pulse: true } } })
      })

      it('should support partial updates of several flags at once', async () => {
        const changes = { pulse: true, 'dual-channel': false }
        const context = createContext(ALLOWED_ADDRESS, { flags: changes })
        const response = await updateFeatureFlagsHandler(context as any)

        expect(response.status).toBe(200)
        expect(mockFeatureFlagsDb.update).toHaveBeenCalledWith(changes, ALLOWED_ADDRESS)
      })

      it('should log who updated the flags', async () => {
        const context = createContext(ALLOWED_ADDRESS, { flags: { pulse: true } })
        await updateFeatureFlagsHandler(context as any)

        const logger = (mockLogs.getLogger as jest.Mock).mock.results[0].value
        expect(logger.info).toHaveBeenCalledWith('Feature flags updated', expect.objectContaining({ updatedBy: ALLOWED_ADDRESS }))
      })
    })

    describe('and the db fails', () => {
      it('should return 500 with the error envelope', async () => {
        mockFeatureFlagsDb.update.mockRejectedValue(new Error('db down'))

        const context = createContext(ALLOWED_ADDRESS, { flags: { pulse: true } })
        const response = await updateFeatureFlagsHandler(context as any)

        expect(response.status).toBe(500)
        expect(response.body).toEqual({ ok: false, error: 'Internal server error' })
      })
    })
  })
})
