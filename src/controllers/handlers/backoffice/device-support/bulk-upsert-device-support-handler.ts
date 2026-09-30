import { DecentralandSignatureContext } from '@dcl/crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { isAllowedUser } from '../../../../logic/allowed-users'
import { validateSoc, validatePublicDecision, PublicDecision } from '../../../../logic/device-support'

type BulkUpsertBody = {
  entries?: unknown
}

// The real seed is ~320 entries; this gives ~3x headroom for the list to grow before the cap
// needs revisiting, without being large enough to make one bad request pathological to process.
export const MAX_BULK_ENTRIES = 1000

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

  let body: BulkUpsertBody
  try {
    body = (await request.json()) as BulkUpsertBody
  } catch (error) {
    return { status: 400, body: { ok: false, error: 'Invalid JSON body' } }
  }

  if (typeof body !== 'object' || body === null) {
    return { status: 400, body: { ok: false, error: "'entries' must be an array" } }
  }
  if (!Array.isArray(body.entries)) {
    return { status: 400, body: { ok: false, error: "'entries' must be an array" } }
  }
  if (body.entries.length === 0) {
    return { status: 400, body: { ok: false, error: "'entries' must not be empty" } }
  }
  if (body.entries.length > MAX_BULK_ENTRIES) {
    return { status: 400, body: { ok: false, error: `'entries' must have at most ${MAX_BULK_ENTRIES} items` } }
  }

  const validated: { soc: string; decision: PublicDecision }[] = []
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
    // Allows 'keep' here (unlike the single-soc upsert): a bulk payload is a whole-sheet refresh,
    // and 'keep' is how it expresses "revert this soc" -- see bulkUpsert.
    const decisionError = validatePublicDecision(decision)
    if (decisionError) {
      return { status: 400, body: { ok: false, error: `entries[${index}]: ${decisionError}` } }
    }
    validated.push({ soc: soc as string, decision: decision as PublicDecision })
  }

  try {
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
