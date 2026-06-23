import { createMagicComponent } from '../../../src/adapters/magic'
import { createConfigJestMockComponent } from '../../mocks/config-mock'
import { createFetchMockComponent, createMockResponse } from '../../mocks/fetch-mock'
import { createLogsMockComponent } from '../../mocks/logs-mock'

describe('magic adapter', () => {
  const ADDRESS = '0xD63823fe5ed2e42e32096dE618E9542edBC5C797'

  describe('when MAGIC_SECRET_KEY is not configured', () => {
    it('fails fast at boot rather than silently no-opping', async () => {
      const config = createConfigJestMockComponent({})
      const fetch = createFetchMockComponent()
      const logs = createLogsMockComponent()

      await expect(createMagicComponent({ config, fetch, logs })).rejects.toThrow(
        /MAGIC_SECRET_KEY/
      )
    })
  })

  describe('when MAGIC_SECRET_KEY is configured', () => {
    function setup(secretKey = 'sk_test_123') {
      const config = createConfigJestMockComponent({ MAGIC_SECRET_KEY: secretKey })
      const fetch = createFetchMockComponent()
      const logs = createLogsMockComponent()
      return { config, fetch, logs }
    }

    it('looks up the user and reports "processed" when Magic processes the address', async () => {
      const { config, fetch, logs } = setup()

      fetch.fetch.mockImplementation((url: any) => {
        if (typeof url === 'string' && url.includes('/v2/admin/auth/user/get')) {
          return Promise.resolve(createMockResponse({ data: { email: 'user@example.com' } }))
        }
        return Promise.resolve(
          createMockResponse({
            processed: [ADDRESS.toLowerCase()],
            unprocessed: []
          })
        )
      })

      const magic = await createMagicComponent({ config, fetch, logs })
      const result = await magic.requestDeletion(ADDRESS)

      expect(result).toEqual({ status: 'processed', email: 'user@example.com' })
      expect(fetch.fetch).toHaveBeenCalledTimes(2)

      const [, deletionCall] = fetch.fetch.mock.calls
      expect(deletionCall[0]).toMatch(/\/v1\/admin\/user\/deletion\/request$/)
      expect(deletionCall[1]).toMatchObject({
        method: 'POST',
        headers: expect.objectContaining({
          'X-Magic-Secret-Key': 'sk_test_123',
          'Content-Type': 'application/json'
        })
      })
      expect(JSON.parse(deletionCall[1].body as string)).toEqual({
        public_addresses: [ADDRESS]
      })
    })

    it('reports "not_found" when the address is not in processed', async () => {
      const { config, fetch, logs } = setup()

      fetch.fetch.mockImplementation((url: any) => {
        if (typeof url === 'string' && url.includes('/v2/admin/auth/user/get')) {
          return Promise.resolve(createMockResponse({}, false, 404))
        }
        return Promise.resolve(
          createMockResponse({
            processed: [],
            unprocessed: [ADDRESS.toLowerCase()]
          })
        )
      })

      const magic = await createMagicComponent({ config, fetch, logs })
      const result = await magic.requestDeletion(ADDRESS)

      expect(result).toEqual({ status: 'not_found', email: undefined })
    })

    it('returns "error" when the deletion endpoint fails', async () => {
      const { config, fetch, logs } = setup()

      fetch.fetch.mockImplementation((url: any) => {
        if (typeof url === 'string' && url.includes('/v2/admin/auth/user/get')) {
          return Promise.resolve(createMockResponse({ data: { email: 'user@example.com' } }))
        }
        return Promise.resolve(createMockResponse({ error: 'rate limited' }, false, 429))
      })

      const magic = await createMagicComponent({ config, fetch, logs })
      const result = await magic.requestDeletion(ADDRESS)

      expect(result).toEqual({
        status: 'error',
        email: 'user@example.com',
        error: 'HTTP 429'
      })
    })

    it('returns "error" when fetch throws', async () => {
      const { config, fetch, logs } = setup()

      fetch.fetch.mockRejectedValue(new Error('network down'))

      const magic = await createMagicComponent({ config, fetch, logs })
      const result = await magic.requestDeletion(ADDRESS)

      expect(result.status).toBe('error')
      expect(result.error).toBe('network down')
    })
  })
})
