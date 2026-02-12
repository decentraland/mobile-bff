import { HandlerContextWithPath } from '../../../types'

export async function getDestinationsHandler(
  context: HandlerContextWithPath<'placesDb' | 'destinationsApi' | 'logs', '/destinations'>
) {
  const { components: { placesDb, destinationsApi, logs }, url, request } = context
  const logger = logs.getLogger('get-destinations')

  // Extract signed fetch headers to forward to upstream API
  const headersToForward: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    if (key.toLowerCase().startsWith('x-identity-')) {
      headersToForward[key.toLowerCase()] = value
    }
  })

  try {
    const searchParams = new URL(url.toString()).searchParams
    const tagParam = searchParams.get('tag')

    if (tagParam) {
      const tags = tagParam.split(',').map(t => t.trim()).filter(Boolean)
      if (tags.length === 0) {
        return { status: 400, body: { ok: false, error: 'Invalid tag parameter' } }
      }

      const places = await placesDb.getAllPlaces(tags)

      // Remove 'tag' from params, pass the rest to API
      searchParams.delete('tag')
      const response = await destinationsApi.getForPlaces(places, searchParams.toString(), headersToForward)

      return { status: 200, body: response }
    }

    searchParams.delete('tag')
    const response = await destinationsApi.proxyQuery(searchParams.toString(), headersToForward)
    return { status: 200, body: response }

  } catch (error) {
    logger.error('Error', { error: (error as Error).message })
    return { status: 500, body: { ok: false, error: 'Internal server error' } }
  }
}
