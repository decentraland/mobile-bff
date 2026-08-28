import { DecentralandSignatureContext } from '@dcl/crypto-middleware'
import { HandlerContextWithPath } from '../../types'
import { extractAuthChain } from '../../logic/auth'

export async function cancelDeletionHandler(
  context: HandlerContextWithPath<'db' | 'slack' | 'logs', '/deletion'> & DecentralandSignatureContext<any>
) {
  const {
    components: { db, slack, logs },
    verification,
    request
  } = context

  const logger = logs.getLogger('cancel-deletion')
  const userAddress = verification?.auth

  if (!userAddress) {
    return {
      status: 401,
      body: { ok: false, error: 'Unauthorized' }
    }
  }

  try {
    const deletionRequest = await db.cancelDeletionRequest(userAddress)

    if (!deletionRequest) {
      return {
        status: 404,
        body: { ok: false, error: 'No pending deletion request found' }
      }
    }

    logger.info('Deletion request cancelled', { userAddress })

    // Extract auth chain from headers
    const headers: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value
    })
    const authChain = extractAuthChain(headers)

    // Send Slack notification (fire and forget)
    slack.sendCancellationNotification(userAddress, authChain).catch((err) => {
      logger.error('Failed to send Slack notification', { error: err.message })
    })

    return {
      status: 200,
      body: {
        ok: true,
        data: {
          userAddress: deletionRequest.userAddress,
          requestedAt: deletionRequest.requestedAt,
          cancelledAt: deletionRequest.cancelledAt,
          status: deletionRequest.status
        }
      }
    }
  } catch (error) {
    logger.error('Error cancelling deletion request', { error: (error as Error).message, userAddress })
    return {
      status: 500,
      body: { ok: false, error: 'Internal server error' }
    }
  }
}
