import { DecentralandSignatureContext } from '@dcl/crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { isAllowedUser } from '../../../../logic/allowed-users'
import { validateToken, validateTarget } from '../../../../logic/campaigns'

const PG_UNIQUE_VIOLATION = '23505'

export async function createCampaignHandler(
  context: HandlerContextWithPath<'campaignsDb' | 'logs' | 'config', '/backoffice/campaigns'>
    & DecentralandSignatureContext<any>
) {
  const {
    components: { campaignsDb, logs, config },
    verification,
    request
  } = context

  const logger = logs.getLogger('create-campaign')
  const userAddress = verification?.auth

  if (!userAddress) {
    return { status: 401, body: { ok: false, error: 'Unauthorized' } }
  }

  if (!(await isAllowedUser(config, userAddress))) {
    return { status: 403, body: { ok: false, error: 'Forbidden: User not in allowed list' } }
  }

  let token = ''
  try {
    const body = await request.json()

    const tokenError = validateToken(body.token)
    if (tokenError) {
      return { status: 400, body: { ok: false, error: tokenError } }
    }
    token = body.token as string

    const target = validateTarget(body)
    if ('error' in target) {
      return { status: 400, body: { ok: false, error: target.error } }
    }

    const campaign = await campaignsDb.create({ token, ...target })

    logger.info('Campaign created', { token, createdBy: userAddress })

    return { status: 201, body: { ok: true, data: campaign } }
  } catch (error) {
    if ((error as { code?: string }).code === PG_UNIQUE_VIOLATION) {
      return { status: 409, body: { ok: false, error: `Campaign '${token}' already exists` } }
    }
    logger.error('Error creating campaign', {
      error: (error as Error).message,
      createdBy: userAddress
    })
    return { status: 500, body: { ok: false, error: 'Internal server error' } }
  }
}
