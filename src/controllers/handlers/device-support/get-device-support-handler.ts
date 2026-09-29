import { HandlerContextWithPath } from '../../../types'
import { validateSoc, normalizeSoc } from '../../../logic/device-support'

export async function getDeviceSupportHandler(
  context: HandlerContextWithPath<'deviceSupportDb' | 'logs', '/device-support'>
) {
  const {
    components: { deviceSupportDb, logs },
    url
  } = context

  const logger = logs.getLogger('get-device-support')

  try {
    const searchParams = new URL(url.toString()).searchParams
    const soc = searchParams.get('soc')

    const socError = validateSoc(soc)
    if (socError) {
      return { status: 400, body: { ok: false, error: socError } }
    }

    const normalized = normalizeSoc(soc as string)
    const decision = await deviceSupportDb.getDecision(normalized)

    // Echoes the normalized value, not the raw query param, so the client can confirm exactly
    // what was looked up rather than what it happened to send.
    return {
      status: 200,
      body: { ok: true, data: { soc: normalized, decision } }
    }
  } catch (error) {
    logger.error('Error fetching device support decision', { error: (error as Error).message })
    return { status: 500, body: { ok: false, error: 'Internal server error' } }
  }
}
