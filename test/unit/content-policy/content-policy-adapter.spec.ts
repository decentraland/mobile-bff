import { createContentPolicyComponent } from '../../../src/adapters/content-policy'
import { createConfigJestMockComponent } from '../../mocks/config-mock'
import { createFeatureFlagsDbJestMockComponent, createTestFeatureFlag } from '../../mocks/feature-flags-db-mock'
import { createFetchMockComponent, createMockResponse } from '../../mocks/fetch-mock'
import { createLogsMockComponent } from '../../mocks/logs-mock'
import { createPlacesDbMockComponent, createTestPlace, createTestWorldPlace } from '../../mocks/places-db-mock'
import type { Place } from '../../../src/adapters/places-db'

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

  // getAllPlaces answers per tag: the banned_ios places and the allowed_ios ones
  function tagged(places: { banned?: Place[]; allowed?: Place[] }) {
    placesDb.getAllPlaces.mockImplementation(async (tags?: string[]) =>
      tags?.[0] === 'banned_ios' ? (places.banned ?? []) : (places.allowed ?? [])
    )
  }

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
      tagged({ banned: [createTestPlace({ basePosition: '9,9', positions: ['9,9'] })] })

      const index = await (await create()).getBlockIndex()

      expect(placesDb.getAllPlaces).toHaveBeenCalledWith(['banned_ios'])
      expect(placesDb.getAllPlaces).toHaveBeenCalledWith(['allowed_ios'])
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

    it('should leave out the rule-blocked places tagged allowed_ios', async () => {
      fetch.fetch.mockResolvedValue(
        createMockResponse({
          data: [
            { id: 'kept', base_position: '1,1', positions: ['1,1'], content_rating: 'A' },
            { id: 'hidden', base_position: '2,2', positions: ['2,2'], content_rating: 'A' }
          ]
        })
      )
      tagged({ allowed: [createTestPlace({ basePosition: '1,1', positions: ['1,1'] })] })

      const index = await (await create()).getBlockIndex()

      expect(index.placeIds).toEqual(new Set(['hidden']))
      expect(index.allowed.parcels).toEqual(new Set(['1,1']))
    })

    it('should build once and serve concurrent and later callers from the cache', async () => {
      fetch.fetch.mockResolvedValue(createMockResponse({ data: [] }))
      const policy = await create()

      await Promise.all([policy.getBlockIndex(), policy.getBlockIndex()])
      await policy.getBlockIndex()

      expect(fetch.fetch).toHaveBeenCalledTimes(1)
      // Once for banned_ios, once for allowed_ios
      expect(placesDb.getAllPlaces).toHaveBeenCalledTimes(2)
    })

    it('should answer the stale index while it rebuilds once the cache expires', async () => {
      fetch.fetch.mockResolvedValue(createMockResponse({ data: [] }))
      tagged({ banned: [createTestPlace({ basePosition: '1,1', positions: ['1,1'] })] })
      const policy = await create('0')

      const first = await policy.getBlockIndex()
      tagged({ banned: [createTestPlace({ basePosition: '2,2', positions: ['2,2'] })] })
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
      tagged({ banned: [createTestPlace({ basePosition: '9,9', positions: ['9,9'] })] })

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
      // Two builds, each asking for banned_ios and allowed_ios
      expect(placesDb.getAllPlaces).toHaveBeenCalledTimes(4)
    })
  })

  describe('getBannedPlaces', () => {
    const scene = createTestPlace({ id: 'scene', basePosition: '1,1', positions: ['1,1', '1,2'] })
    const world = createTestWorldPlace({ id: 'world', worldName: 'Sin.dcl.eth' })

    it('should answer the parcels and worlds tagged banned, read once per window', async () => {
      placesDb.getAllPlaces.mockResolvedValue([scene, world])
      const policy = await create()

      const banned = await policy.getBannedPlaces()
      await policy.getBannedPlaces()

      expect(banned).toEqual({ parcels: new Set(['1,1', '1,2']), worlds: new Set(['sin.dcl.eth']) })
      expect(placesDb.getAllPlaces).toHaveBeenCalledTimes(1)
      expect(placesDb.getAllPlaces).toHaveBeenCalledWith(['banned'])
    })

    it('should answer null while no place is tagged banned', async () => {
      expect(await (await create()).getBannedPlaces()).toBeNull()
    })

    it('should keep the last list when the database fails', async () => {
      placesDb.getAllPlaces.mockResolvedValueOnce([scene]).mockRejectedValueOnce(new Error('db down'))
      const policy = await create('0')

      const first = await policy.getBannedPlaces()

      expect(await policy.getBannedPlaces()).toBe(first)
      expect(placesDb.getAllPlaces).toHaveBeenCalledTimes(2)
    })
  })
})
