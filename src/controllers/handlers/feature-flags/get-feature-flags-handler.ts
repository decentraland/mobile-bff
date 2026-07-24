import { HandlerContextWithPath } from '../../../types'

export async function getFeatureFlagsHandler(
  context: HandlerContextWithPath<'featureFlagsDb' | 'logs', '/feature-flags'>
) {
  const {
    components: { featureFlagsDb, logs }
  } = context

  const logger = logs.getLogger('get-feature-flags')

  try {
    const flags = await featureFlagsDb.getAll()
    return {
      status: 200,
      body: { ok: true, data: { flags } }
    }
  } catch (error) {
    logger.error('Error fetching feature flags', { error: (error as Error).message })
    return {
      status: 500,
      body: { ok: false, error: 'Internal server error' }
    }
  }
}
