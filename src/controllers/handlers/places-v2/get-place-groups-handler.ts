import { HandlerContextWithPath } from '../../../types'

export async function getPlaceGroupsHandler(
  context: HandlerContextWithPath<'placeGroupsDb' | 'placesDb' | 'logs', '/v2/place-groups'>
) {
  const {
    components: { placeGroupsDb, logs }
  } = context

  const logger = logs.getLogger('get-place-groups')

  try {
    const groups = await placeGroupsDb.getAllPlaceGroups()

    return {
      status: 200,
      body: {
        ok: true,
        data: groups
      }
    }
  } catch (error) {
    logger.error('Error fetching place groups', { error: (error as Error).message })
    return {
      status: 500,
      body: { ok: false, error: 'Internal server error' }
    }
  }
}
