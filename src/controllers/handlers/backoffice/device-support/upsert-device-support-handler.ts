import { DecentralandSignatureContext } from '@dcl/crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { isAllowedUser } from '../../../../logic/allowed-users'
import { validateSoc, validateDecision, Decision } from '../../../../logic/device-support'

type UpsertBody = {
  decision?: unknown
}

export async function upsertDeviceSupportHandler(
  context: HandlerContextWithPath<'deviceSupportDb' | 'logs' | 'config', '/backoffice/device-support/:soc'>
    & DecentralandSignatureContext<any>
) {
  const {
    components: { deviceSupportDb, logs, config },
    verification,
    params,
    request
  } = context

  const logger = logs.getLogger('upsert-device-support')
  const userAddress = verification?.auth
  const soc = params.soc

  if (!userAddress) {
    return { status: 401, body: { ok: false, error: 'Unauthorized' } }
  }

  if (!(await isAllowedUser(config, userAddress))) {
    return { status: 403, body: { ok: false, error: 'Forbidden: User not in allowed list' } }
  }

  const socError = validateSoc(soc)
  if (socError) {
    return { status: 400, body: { ok: false, error: socError } }
  }

  let body: UpsertBody
  try {
    body = (await request.json()) as UpsertBody
  } catch (error) {
    return { status: 400, body: { ok: false, error: 'Invalid JSON body' } }
  }

  if (typeof body !== 'object' || body === null) {
    return { status: 400, body: { ok: false, error: validateDecision(undefined) } }
  }

  const decisionError = validateDecision(body.decision)
  if (decisionError) {
    return { status: 400, body: { ok: false, error: decisionError } }
  }

  try {
    const entry = await deviceSupportDb.upsert(soc, body.decision as Decision, userAddress)

    logger.info('Device support entry upserted', { soc, decision: entry.decision, updatedBy: userAddress })

    return { status: 200, body: { ok: true, data: entry } }
  } catch (error) {
    logger.error('Error upserting device support entry', {
      error: (error as Error).message,
      soc,
      updatedBy: userAddress
    })
    return { status: 500, body: { ok: false, error: 'Internal server error' } }
  }
}
