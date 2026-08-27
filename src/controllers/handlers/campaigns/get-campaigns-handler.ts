import { HandlerContextWithPath } from '../../../types'

// Client-facing campaign map. Read by godot-explorer on boot (Campaigns autoload) to
// resolve the `?c=<token>` carried by an ad / referrer link into the scene it opens.
export async function getCampaignsHandler(
  context: HandlerContextWithPath<'campaignsDb' | 'logs', '/campaigns'>
) {
  const {
    components: { campaignsDb, logs }
  } = context

  const logger = logs.getLogger('get-campaigns')

  try {
    const campaigns = await campaignsDb.getMap()
    return {
      status: 200,
      body: { ok: true, data: { campaigns } }
    }
  } catch (error) {
    logger.error('Error fetching campaigns', { error: (error as Error).message })
    return {
      status: 500,
      body: { ok: false, error: 'Internal server error' }
    }
  }
}
