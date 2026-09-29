import { DecentralandSignatureContext } from '@dcl/crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { isAllowedUser } from '../../../../logic/allowed-users'
import { validateSoc, validateDecision, Decision } from '../../../../logic/device-support'

type BulkUpsertBody = {
  entries?: unknown
}

// Sized to comfortably fit the real ~320-entry list with headroom, matching the SoC-list caps
// already used for the (now-abandoned) feature-flags approach.
export const MAX_BULK_ENTRIES = 2000

export async function bulkUpsertDeviceSupportHandler(
  context: HandlerContextWithPath<'deviceSupportDb' | 'logs' | 'config', '/backoffice/device-support'>
    & DecentralandSignatureContext<any>
) {
  const {
    components: { deviceSupportDb, logs, config },
    verification,
    request
  } = context

  const logger = logs.getLogger('bulk-upsert-device-support')
  const userAddress = verification?.auth

  if (!userAddress) {
    return { status: 401, body: { ok: false, error: 'Unauthorized' } }
  }

  if (!(await isAllowedUser(config, userAddress))) {
    return { status: 403, body: { ok: false, error: 'Forbidden: User not in allowed list' } }
  }

  try {
    const body = (await request.json()) as BulkUpsertBody

    if (!Array.isArray(body.entries)) {
      return { status: 400, body: { ok: false, error: "'entries' must be an array" } }
    }
    if (body.entries.length === 0) {
      return { status: 400, body: { ok: false, error: "'entries' must not be empty" } }
    }
    if (body.entries.length > MAX_BULK_ENTRIES) {
      return { status: 400, body: { ok: false, error: `'entries' must have at most ${MAX_BULK_ENTRIES} items` } }
    }

    const validated: { soc: string; decision: Decision }[] = []
    for (let index = 0; index < body.entries.length; index++) {
      const entry = body.entries[index]
      if (typeof entry !== 'object' || entry === null) {
        return { status: 400, body: { ok: false, error: `entries[${index}] must be an object` } }
      }
      const soc = (entry as Record<string, unknown>).soc
      const decision = (entry as Record<string, unknown>).decision

      const socError = validateSoc(soc)
      if (socError) {
        return { status: 400, body: { ok: false, error: `entries[${index}]: ${socError}` } }
      }
      const decisionError = validateDecision(decision)
      if (decisionError) {
        return { status: 400, body: { ok: false, error: `entries[${index}]: ${decisionError}` } }
      }
      validated.push({ soc: soc as string, decision: decision as Decision })
    }

    const count = await deviceSupportDb.bulkUpsert(validated, userAddress)

    logger.info('Device support bulk upsert', { count, updatedBy: userAddress })

    return { status: 200, body: { ok: true, data: { count } } }
  } catch (error) {
    logger.error('Error bulk-upserting device support entries', {
      error: (error as Error).message,
      updatedBy: userAddress
    })
    return { status: 500, body: { ok: false, error: 'Internal server error' } }
  }
}
