import { DecentralandSignatureContext, AUTH_CHAIN_HEADER_PREFIX } from '@dcl/platform-crypto-middleware'
import { AuthChain, AuthLink } from '@dcl/crypto'
import { HandlerContextWithPath } from '../../types'

function extractAuthChain(headers: Record<string, string>): AuthChain {
  const authChain: AuthLink[] = []
  let i = 0
  while (headers[`${AUTH_CHAIN_HEADER_PREFIX}${i}`]) {
    authChain.push(JSON.parse(headers[`${AUTH_CHAIN_HEADER_PREFIX}${i}`]))
    i++
  }
  return authChain
}

export async function requestDeletionHandler(
  context: HandlerContextWithPath<'db' | 'slack' | 'logs', '/deletion'> & DecentralandSignatureContext<any>
) {
  const {
    components: { db, slack, logs },
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

    // Extract auth chain from headers
    const headers: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value
    })
    const authChain = extractAuthChain(headers)

    // Send Slack notification (fire and forget)
    slack.sendDeletionRequestNotification(userAddress, authChain).catch((err) => {
      logger.error('Failed to send Slack notification', { error: err.message })
    })

    return {
      status: 201,
      body: {
        ok: true,
        data: {
          userAddress: deletionRequest.userAddress,
          requestedAt: deletionRequest.requestedAt,
          status: deletionRequest.status
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
