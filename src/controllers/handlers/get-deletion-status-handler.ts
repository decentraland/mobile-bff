import { DecentralandSignatureContext } from '@dcl/platform-crypto-middleware'
import { HandlerContextWithPath } from '../../types'

export async function getDeletionStatusHandler(
  context: HandlerContextWithPath<'db' | 'logs', '/deletion'> & DecentralandSignatureContext<any>
) {
  const {
    components: { db, logs },
    verification
  } = context

  const logger = logs.getLogger('get-deletion-status')
  const userAddress = verification?.auth

  if (!userAddress) {
    return {
      status: 401,
      body: { ok: false, error: 'Unauthorized' }
    }
  }

  try {
    const deletionRequest = await db.getDeletionRequest(userAddress)

    if (!deletionRequest) {
      return {
        status: 200,
        body: {
          ok: true,
          data: null
        }
      }
    }

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
    logger.error('Error getting deletion status', { error: (error as Error).message, userAddress })
    return {
      status: 500,
      body: { ok: false, error: 'Internal server error' }
    }
  }
}
