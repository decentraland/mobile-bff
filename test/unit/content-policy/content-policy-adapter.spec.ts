import { createContentPolicyComponent } from '../../../src/adapters/content-policy'
import { createConfigJestMockComponent } from '../../mocks/config-mock'
import { createFeatureFlagsDbJestMockComponent, createTestFeatureFlag } from '../../mocks/feature-flags-db-mock'
import { createFetchMockComponent, createMockResponse } from '../../mocks/fetch-mock'
import { createLogsMockComponent } from '../../mocks/logs-mock'
import { createPlacesDbMockComponent, createTestPlace } from '../../mocks/places-db-mock'

const API = 'https://places.example.com/api/destinations'

describe('content-policy adapter', () => {
  let fetch: ReturnType<typeof createFetchMockComponent>
  let featureFlagsDb: ReturnType<typeof createFeatureFlagsDbJestMockComponent>
  let placesDb: ReturnType<typeof createPlacesDbMockComponent>

  beforeEach(() => {
    fetch = createFetchMockComponent()
    featureFlagsDb = createFeatureFlagsDbJestMockComponent()
    placesDb = createPlacesDbMockComponent()
    placesDb.getAllPlaces.mockResolvedValue([])
  })

  function create(ttl = '600000') {
    return createContentPolicyComponent({
      fetch,
      config: createConfigJestMockComponent({ DESTINATIONS_API_URL: API, CONTENT_POLICY_CACHE_TTL_MS: ttl }),
      logs: createLogsMockComponent(),
      featureFlagsDb,
      placesDb
    })
  }

  describe('isBlockListEnabled', () => {
    it('should follow the ios-blocklist flag', async () => {
      featureFlagsDb.getByName.mockResolvedValue(createTestFeatureFlag({ name: 'ios-blocklist', enabled: false }))
      expect(await (await create()).isBlockListEnabled()).toBe(false)
      expect(featureFlagsDb.getByName).toHaveBeenCalledWith('ios-blocklist')
    })

    it('should default to the block list when the flag is missing or unreadable', async () => {
      featureFlagsDb.getByName.mockResolvedValueOnce(null)
      featureFlagsDb.getByName.mockRejectedValueOnce(new Error('db down'))
      const policy = await create()
      expect(await policy.isBlockListEnabled()).toBe(true)
      expect(await policy.isBlockListEnabled()).toBe(true)
    })
  })

  describe('getBlockIndex', () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      id: `p${i}`,
      base_position: `0,${i}`,
      content_rating: 'T'
    }))

    it('should walk the whole catalog and add the places tagged banned_ios', async () => {
      fetch.fetch
        .mockResolvedValueOnce(
          createMockResponse({
            total: 101,
            data: [...fullPage.slice(1), { id: 'a', base_position: '1,1', content_rating: 'A' }]
          })
        )
        .mockResolvedValueOnce(
          createMockResponse({ data: [{ id: 'c', world: true, world_name: 'Casino.dcl.eth', categories: ['casino'] }] })
        )
        .mockResolvedValueOnce(createMockResponse({ data: [] }))
      placesDb.getAllPlaces.mockResolvedValue([createTestPlace({ basePosition: '9,9', positions: ['9,9'] })])

      const index = await (await create()).getBlockIndex()

      expect(placesDb.getAllPlaces).toHaveBeenCalledWith(['banned_ios'])
      expect(fetch.fetch).toHaveBeenNthCalledWith(1, `${API}?offset=0&limit=100`)
      expect(fetch.fetch).toHaveBeenNthCalledWith(2, `${API}?offset=100&limit=100`)
      expect(index.placeIds).toEqual(new Set(['a', 'c']))
      expect(index.parcels).toEqual(new Set(['1,1', '9,9']))
      expect(index.worlds).toEqual(new Set(['casino.dcl.eth']))
    })

    it('should ask for the pages after the first one together, plus one past the total', async () => {
      fetch.fetch.mockImplementation(async (url: any) =>
        createMockResponse(String(url).includes('offset=0&') ? { total: 350, data: fullPage } : { data: fullPage })
      )

      await (await create()).getBlockIndex()

      // ceil(350 / 100) + 1 pages: offsets 0..400
      expect(fetch.fetch).toHaveBeenCalledTimes(5)
      expect(fetch.fetch).toHaveBeenLastCalledWith(`${API}?offset=400&limit=100`)
    })

    it('should build once and serve concurrent and later callers from the cache', async () => {
      fetch.fetch.mockResolvedValue(createMockResponse({ data: [] }))
      const policy = await create()

      await Promise.all([policy.getBlockIndex(), policy.getBlockIndex()])
      await policy.getBlockIndex()

      expect(fetch.fetch).toHaveBeenCalledTimes(1)
      expect(placesDb.getAllPlaces).toHaveBeenCalledTimes(1)
    })

    it('should answer the stale index while it rebuilds once the cache expires', async () => {
      fetch.fetch.mockResolvedValue(createMockResponse({ data: [] }))
      placesDb.getAllPlaces
        .mockResolvedValueOnce([createTestPlace({ basePosition: '1,1', positions: ['1,1'] })])
        .mockResolvedValueOnce([createTestPlace({ basePosition: '2,2', positions: ['2,2'] })])
      const policy = await create('0')

      const first = await policy.getBlockIndex()
      await new Promise((resolve) => setTimeout(resolve, 2))
      const stale = await policy.getBlockIndex()
      await new Promise((resolve) => setTimeout(resolve, 2))
      const rebuilt = await policy.getBlockIndex()

      expect(first.parcels).toEqual(new Set(['1,1']))
      expect(stale.parcels).toEqual(new Set(['1,1']))
      expect(rebuilt.parcels).toEqual(new Set(['2,2']))
    })

    it('should still index the banned_ios places when the catalog is unreachable', async () => {
      fetch.fetch.mockResolvedValue(createMockResponse({}, false, 503))
      placesDb.getAllPlaces.mockResolvedValue([createTestPlace({ basePosition: '9,9', positions: ['9,9'] })])

      const index = await (await create()).getBlockIndex()

      expect(index.parcels).toEqual(new Set(['9,9']))
    })

    it('should answer an empty index without caching it when the database fails', async () => {
      placesDb.getAllPlaces.mockRejectedValueOnce(new Error('db down'))
      fetch.fetch.mockResolvedValue(createMockResponse({ data: [] }))
      const policy = await create()

      const index = await policy.getBlockIndex()
      await policy.getBlockIndex()

      expect(index.parcels.size + index.worlds.size + index.placeIds.size).toBe(0)
      expect(placesDb.getAllPlaces).toHaveBeenCalledTimes(2)
    })
  })
})
