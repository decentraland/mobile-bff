import { IBaseComponent, IConfigComponent, IFetchComponent, ILoggerComponent } from '@well-known-components/interfaces'
import { ICacheComponent } from './cache'

// The thumbnail a comeback push carries, looked up when the push is sent.
//
// The warehouse picks the destination days before the send — a trigger lingers in the audience
// feed for up to three days — so it publishes the place's catalogue id and this resolves the
// image from it at send time. A place that changed its thumbnail in between is sent the new
// one, and a lookup that fails sends none, which falls back to the campaign's own image rather
// than holding the delivery.
export interface IPlaceThumbnailsComponent extends IBaseComponent {
  get(placeId: string): Promise<string | null>
}

type Components = {
  fetch: IFetchComponent
  config: IConfigComponent
  cache: ICacheComponent
  logs: ILoggerComponent
}

type PlaceResponse = {
  ok?: boolean
  data?: { image?: string | null } | { image?: string | null }[]
}

const cacheKey = (placeId: string) => `place:thumb:${placeId}`

// Same reason as thirdweb-proxy: the node-fetch types underneath IFetchComponent declare their
// own AbortSignal, so the timeout is driven through this rather than the standard `signal`.
type FetchInit = Parameters<IFetchComponent['fetch']>[1] & { abortController?: AbortController }

export async function createPlaceThumbnailsComponent(components: Components): Promise<IPlaceThumbnailsComponent> {
  const { fetch, config, cache, logs } = components
  const logger = logs.getLogger('place-thumbnails')

  const apiUrl = (await config.getString('PLACES_API_URL')) ?? 'https://places.decentraland.org/api/places'
  const ttlMs = parseInt((await config.getString('PLACE_THUMBNAIL_CACHE_TTL_MS')) ?? '21600000')
  const timeoutMs = parseInt((await config.getString('PLACE_THUMBNAIL_TIMEOUT_MS')) ?? '3000')

  async function get(placeId: string): Promise<string | null> {
    // A miss and a known-empty are both cached: a place with no thumbnail would otherwise be
    // looked up again for every delivery of the same campaign.
    const cached = await cache.get<string>(cacheKey(placeId))
    if (cached !== null) {
      return cached.length > 0 ? cached : null
    }

    const controller = new AbortController()
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs)
    const init: FetchInit = { method: 'GET', abortController: controller }

    let image: string | null = null
    try {
      const response = await fetch.fetch(`${apiUrl}/${encodeURIComponent(placeId)}`, init)
      if (response.ok) {
        const body = (await response.json()) as PlaceResponse
        const place = Array.isArray(body.data) ? body.data[0] : body.data
        const value = place?.image
        image = typeof value === 'string' && value.startsWith('https://') ? value : null
      } else {
        logger.debug('Place lookup returned a non-OK status', { placeId, status: String(response.status) })
      }
    } catch (error: any) {
      logger.debug('Place lookup failed', { placeId, error: error?.message ?? 'unknown' })
      // Not cached: a timeout is about the network, not about the place, and caching it would
      // blank the image for every delivery that follows inside the TTL.
      return null
    } finally {
      clearTimeout(timeoutHandle)
    }

    await cache.set(cacheKey(placeId), image ?? '', ttlMs)
    return image
  }

  return { get }
}
