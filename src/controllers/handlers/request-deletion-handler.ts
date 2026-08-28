import { DecentralandSignatureContext } from '@dcl/crypto-middleware'
import { HandlerContextWithPath } from '../../types'
import { extractAuthChain } from '../../logic/auth'

export async function requestDeletionHandler(
  context: HandlerContextWithPath<'db' | 'slack' | 'logs' | 'magic', '/deletion'> &
    DecentralandSignatureContext<any>
) {
  const {
    components: { db, slack, logs, magic },
    verification,
    request
  } = context

  const logger = logs.getLogger('request-deletion')
  const userAddress = verification?.auth

  if (!userAddress) {
    return {
      status: 401,
      body: { ok: false, error: 'Unauthorized' }
    }
  }

  try {
    const deletionRequest = await db.createDeletionRequest(userAddress)
    logger.info('Deletion request created', { userAddress })

    const headers: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value
    })
    const authChain = extractAuthChain(headers)

    // Fire-and-forget so the user gets an immediate response; Slack is the team's monitoring channel for the Magic outcome.
    ;(async () => {
      const magicResult = await magic.requestDeletion(userAddress)
      await slack.sendDeletionRequestNotification(userAddress, authChain, magicResult)
    })().catch((err) => {
      logger.error('Background Magic/Slack pipeline failed', {
        error: err.message,
        userAddress
      })
    })

    return {
      status: 201,
      body: {
        ok: true,
        data: {
          userAddress: deletionRequest.userAddress,
          requestedAt: deletionRequest.requestedAt,
          status: deletionRequest.status,
          magic: { status: 'queued' }
        }
      }
    }
  } catch (error) {
    logger.error('Error creating deletion request', { error: (error as Error).message, userAddress })
    return {
      status: 500,
      body: { ok: false, error: 'Internal server error' }
    }
  }
}
