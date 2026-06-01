import { HandlerContextWithPath } from '../../../types'
import { StoreKitVerificationError } from '../../../adapters/apple-storekit'

type WebhookBody = {
  signedPayload?: string
}

// Decodes a JWS payload WITHOUT verifying its signature. Used only to surface
// the notification's routing fields (type/subtype/environment) in logs even
// when verification below rejects it. NEVER used for any trust decision.
function decodeJwsPayloadUnverified(jws: string): any {
  const part = jws?.split?.('.')?.[1]
  if (!part) return null
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

// POST /apple/webhook — App Store Server Notifications V2 (public; Apple posts
// here). Configured in App Store Connect with separate Sandbox and Production
// URLs. For consumables the device-driven /iap/apple/verify is the primary
// crediting path; this webhook handles the events that only Apple can tell us
// about — chiefly REFUND (claw back credits).
//
// Returns 200 for anything we successfully processed OR intentionally ignore,
// so Apple stops retrying. Verification failures return non-2xx so Apple
// retries (and so a forged payload is visibly rejected).
export async function iapWebhookHandler(
  context: HandlerContextWithPath<'iapDb' | 'appleStoreKit' | 'logs', '/apple/webhook'>
) {
  const {
    components: { iapDb, appleStoreKit, logs },
    request
  } = context

  const logger = logs.getLogger('iap-webhook')

  let body: WebhookBody
  try {
    body = (await request.json()) as WebhookBody
  } catch {
    return { status: 400, body: { ok: false, error: 'Invalid JSON body' } }
  }
  const signedPayload = body.signedPayload
  if (typeof signedPayload !== 'string' || signedPayload.length === 0) {
    return { status: 400, body: { ok: false, error: 'signedPayload is required' } }
  }

  // Log the notification's routing fields up-front (unverified decode) so a
  // delivery is traceable even if signature verification below rejects it.
  const peek = decodeJwsPayloadUnverified(signedPayload)
  logger.info('webhook received', {
    bodyLen: signedPayload.length,
    notificationType: peek?.notificationType ?? '',
    subtype: peek?.subtype ?? '',
    notificationUUID: peek?.notificationUUID ?? '',
    environment: peek?.data?.environment ?? ''
  })

  let notification
  try {
    notification = await appleStoreKit.verifyNotification(signedPayload)
  } catch (e) {
    const code = e instanceof StoreKitVerificationError ? e.code : 'VERIFICATION_FAILED'
    logger.warn('webhook verification failed', { code, error: (e as Error).message })
    return { status: 401, body: { ok: false, error: 'notification verification failed', code } }
  }

  const { notificationType, subtype, transaction } = notification
  logger.info('notification verified', {
    type: notificationType,
    subtype: subtype ?? '',
    txId: transaction?.transactionId ?? '',
    productId: transaction?.productId ?? '',
    environment: notification.environment
  })

  switch (notificationType) {
    case 'REFUND':
    case 'REVOKE': {
      // Apple refunded/revoked the purchase — remove the credits. We look the
      // row up by transactionId (recorded at /verify time) which carries the
      // wallet, so no token->wallet resolution is needed here.
      if (transaction?.transactionId) {
        const refunded = await iapDb.markRefunded(transaction.transactionId)
        logger.info('refund processed', { txId: transaction.transactionId, found: String(refunded) })
      } else {
        logger.warn('refund notification without transaction', { type: notificationType })
      }
      break
    }
    case 'ONE_TIME_CHARGE': {
      // Backstop crediting is NOT done here: the notification only carries
      // appAccountToken (an irreversible hash of the wallet), so we cannot
      // resolve which wallet to credit. The device's /iap/apple/verify is the
      // crediting path. If a tx never reaches /verify it can be reconciled
      // later via the App Store Server API history. Logged for visibility.
      logger.info('one-time charge notification (credit happens via /verify)', {
        txId: transaction?.transactionId ?? ''
      })
      break
    }
    default:
      logger.info('ignoring notification type', { type: notificationType })
  }

  return { status: 200, body: { ok: true } }
}
