import { HandlerContextWithPath } from '../../../types'

export async function getAppVersionsHandler(
  context: HandlerContextWithPath<'appVersionsDb' | 'logs', '/app-versions'>
) {
  const {
    components: { appVersionsDb, logs }
  } = context

  const logger = logs.getLogger('get-app-versions')

  try {
    const data = await appVersionsDb.get()
    return {
      status: 200,
      body: { ok: true, data }
    }
  } catch (error) {
    logger.error('Error fetching app versions', { error: (error as Error).message })
    return {
      status: 500,
      body: { ok: false, error: 'Internal server error' }
    }
  }
}
