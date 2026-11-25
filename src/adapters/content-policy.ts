import { IConfigComponent, IFetchComponent, ILoggerComponent } from '@well-known-components/interfaces'
import { IFeatureFlagsDbComponent } from './feature-flags-db'
import { IPlacesDbComponent } from './places-db'
import {
  ALLOWED_IOS_TAG,
  BANNED_IOS_TAG,
  BANNED_TAG,
  BlockIndex,
  buildBlockIndex,
  DestinationRow,
  emptyBlockIndex,
  IOS_BLOCKLIST_FLAG,
  PlaceSet,
  placeSetOf
} from '../logic/content-policy'

export interface IContentPolicyComponent {
  // Whether iOS requests get the block list (true) or the legacy `allowed_ios` allow-list (false)
  isBlockListEnabled(): Promise<boolean>
  getBlockIndex(): Promise<BlockIndex>
  // The places tagged `banned`, hidden on every platform; null while there are none
  getBannedPlaces(): Promise<PlaceSet | null>
}

type Components = {
  fetch: IFetchComponent
  config: IConfigComponent
  logs: ILoggerComponent
  featureFlagsDb: IFeatureFlagsDbComponent
  placesDb: IPlacesDbComponent
}

// The upstream caps `limit` at 100. The page cap only guards against a runaway loop: the whole
// catalog is ~1,500 destinations.
const CATALOG_PAGE_SIZE = 100
const CATALOG_MAX_PAGES = 100
const CATALOG_CONCURRENCY = 8

export async function createContentPolicyComponent(components: Components): Promise<IContentPolicyComponent> {
  const { fetch, config, logs, featureFlagsDb, placesDb } = components
  const logger = logs.getLogger('content-policy')

  const apiUrl = (await config.getString('DESTINATIONS_API_URL')) ?? 'https://places.decentraland.org/api/destinations'
  // A `banned` or `banned_ios` tag and upstream ratings reach the apps within this window; the
  // list responses are filtered on every request, after their own (longer) cache.
  const ttl = parseInt((await config.getString('CONTENT_POLICY_CACHE_TTL_MS')) ?? '600000')

  let cached: { index: BlockIndex; expiresAt: number } | null = null
  let building: Promise<BlockIndex> | null = null

  async function isBlockListEnabled(): Promise<boolean> {
    try {
      const flag = await featureFlagsDb.getByName(IOS_BLOCKLIST_FLAG)
      return flag?.enabled ?? true
    } catch (error) {
      logger.warn('Could not read the flag, keeping the block list', { error: (error as Error).message })
      return true
    }
  }

  async function fetchPage(page: number): Promise<{ rows: DestinationRow[]; total: number | null }> {
    const response = await fetch.fetch(`${apiUrl}?offset=${page * CATALOG_PAGE_SIZE}&limit=${CATALOG_PAGE_SIZE}`)
    if (!response.ok) {
      throw new Error(`catalog page ${page} answered ${response.status}`)
    }
    const body = (await response.json()) as { data?: DestinationRow[]; total?: unknown }
    return {
      rows: Array.isArray(body.data) ? body.data : [],
      total: typeof body.total === 'number' ? body.total : null
    }
  }

  // An upstream page takes ~2 s, so the pages after the first go out together. `total` runs a
  // little behind the rows it pages over, hence the extra page.
  async function fetchCatalog(): Promise<DestinationRow[]> {
    const first = await fetchPage(0)
    if (first.rows.length < CATALOG_PAGE_SIZE) {
      return first.rows
    }
    const pages =
      first.total === null
        ? CATALOG_MAX_PAGES
        : Math.min(CATALOG_MAX_PAGES, Math.ceil(first.total / CATALOG_PAGE_SIZE) + 1)
    const catalog = [...first.rows]
    for (let start = 1; start < pages; start += CATALOG_CONCURRENCY) {
      const batch = Array.from({ length: Math.min(CATALOG_CONCURRENCY, pages - start) }, (_, i) => start + i)
      const results = await Promise.all(batch.map(fetchPage))
      for (const { rows } of results) {
        catalog.push(...rows)
      }
      if (results.some(({ rows }) => rows.length < CATALOG_PAGE_SIZE)) {
        break
      }
    }
    return catalog
  }

  async function build(): Promise<BlockIndex> {
    const start = Date.now()
    const [banned, allowed] = await Promise.all([
      placesDb.getAllPlaces([BANNED_IOS_TAG]),
      placesDb.getAllPlaces([ALLOWED_IOS_TAG])
    ])
    let catalog: DestinationRow[] = []
    try {
      catalog = await fetchCatalog()
    } catch (error) {
      // The rules also run on each destination row, so the lists stay filtered without the
      // catalog; only events lose the rule-blocked places until next time.
      logger.warn('Catalog scan failed, indexing the banned_ios places only', { error: (error as Error).message })
      if (cached) {
        return cached.index
      }
    }
    const index = buildBlockIndex(catalog, banned, allowed)
    logger.info('Block index built', {
      catalog: catalog.length,
      banned: banned.length,
      allowed: allowed.length,
      placeIds: index.placeIds.size,
      parcels: index.parcels.size,
      worlds: index.worlds.size,
      ms: Date.now() - start
    })
    return index
  }

  // Only the first build is waited on: after that a stale index answers while the next one builds.
  async function getBlockIndex(): Promise<BlockIndex> {
    if (cached && Date.now() < cached.expiresAt) {
      return cached.index
    }
    if (!building) {
      building = build()
        .then((index) => {
          cached = { index, expiresAt: Date.now() + ttl }
          return index
        })
        .catch((error) => {
          // Not cached: the next request tries again. The rules on each row still apply.
          logger.error('Block index unavailable', { error: (error as Error).message })
          return cached?.index ?? emptyBlockIndex()
        })
        .finally(() => {
          building = null
        })
    }
    return cached ? cached.index : building
  }

  let banned: { set: PlaceSet | null; expiresAt: number } | null = null

  async function getBannedPlaces(): Promise<PlaceSet | null> {
    if (banned && Date.now() < banned.expiresAt) {
      return banned.set
    }
    try {
      const places = await placesDb.getAllPlaces([BANNED_TAG])
      banned = { set: places.length > 0 ? placeSetOf(places) : null, expiresAt: Date.now() + ttl }
      return banned.set
    } catch (error) {
      logger.warn('Could not read the banned places, keeping the last list', { error: (error as Error).message })
      return banned?.set ?? null
    }
  }

  return { isBlockListEnabled, getBlockIndex, getBannedPlaces }
}
