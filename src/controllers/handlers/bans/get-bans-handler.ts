import { HandlerContextWithPath } from '../../../types'

export async function getBansHandler(
  context: HandlerContextWithPath<'bansDb' | 'logs', '/bans'>
) {
  const {
    components: { bansDb, logs }
  } = context

  const logger = logs.getLogger('get-bans')

  try {
    const bans = await bansDb.getAllBans()

    return {
      status: 200,
      body: {
        ok: true,
        data: bans
      }
    }
  } catch (error) {
    logger.error('Error fetching bans', { error: (error as Error).message })
    return {
      status: 500,
      body: { ok: false, error: 'Internal server error' }
    }
  }
}
