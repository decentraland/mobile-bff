import { HandlerContextWithPath } from '../../../types'

export async function getSceneGroupsHandler(
  context: HandlerContextWithPath<'sceneGroupsDb' | 'logs', '/scene-groups'>
) {
  const {
    components: { sceneGroupsDb, logs },
    url
  } = context

  const logger = logs.getLogger('get-scene-groups')

  try {
    const searchParams = new URL(url.toString()).searchParams
    const parcelParam = searchParams.get('parcel')

    // If parcel is provided, filter by parcel (format: "x,y")
    if (parcelParam !== null) {
      const parts = parcelParam.split(',')

      if (parts.length !== 2) {
        return {
          status: 400,
          body: { ok: false, error: 'Invalid parcel format. Use parcel=x,y (e.g., parcel=0,1)' }
        }
      }

      const x = parseInt(parts[0], 10)
      const y = parseInt(parts[1], 10)

      if (isNaN(x) || isNaN(y)) {
        return {
          status: 400,
          body: { ok: false, error: 'Invalid parcel coordinates. Must be integers.' }
        }
      }

      const group = await sceneGroupsDb.getSceneGroupByParcel(x, y)

      return {
        status: 200,
        body: {
          ok: true,
          data: group
        }
      }
    }

    // Otherwise, return all scene groups
    const groups = await sceneGroupsDb.getAllSceneGroups()

    return {
      status: 200,
      body: {
        ok: true,
        data: groups
      }
    }
  } catch (error) {
    logger.error('Error fetching scene groups', { error: (error as Error).message })
    return {
      status: 500,
      body: { ok: false, error: 'Internal server error' }
    }
  }
}
