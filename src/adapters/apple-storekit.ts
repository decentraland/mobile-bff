// Apple StoreKit 2 JWS verification, wrapping the official
// @apple/app-store-server-library SignedDataVerifier.
//
// Two things get verified here:
//   - Transaction JWS (`Transaction.jwsRepresentation` from the device, posted
//     to /iap/apple/verify): proves a purchase really happened and yields the
//     productId + appAccountToken we credit against.
//   - App Store Server Notification V2 (`signedPayload` posted by Apple to the
//     webhook): drives refunds/backstop.
//
// The trust anchors are the pinned Apple PKI roots (apple-storekit-roots.ts);
// StoreKit chains up to "Apple Root CA - G3". Sandbox and Production are
// distinct verifiers — a Sandbox-signed JWS will NOT verify against the
// Production verifier and vice-versa, which is exactly the isolation we want.

import { Environment, SignedDataVerifier, VerificationException } from '@apple/app-store-server-library'
import { AppComponents } from '../types'
import { APPLE_STOREKIT_ROOT_CERTS } from './apple-storekit-roots'

export type VerifiedTransaction = {
  transactionId: string
  originalTransactionId: string
  productId: string
  appAccountToken?: string
  environment: string
  bundleId: string
  purchaseDate: Date
  type?: string
}

export type DecodedNotification = {
  notificationType: string
  subtype?: string
  notificationUUID?: string
  environment: string
  // Present for transaction-bearing notifications (ONE_TIME_CHARGE, REFUND, ...).
  transaction?: VerifiedTransaction
}

export class StoreKitVerificationError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'StoreKitVerificationError'
    this.code = code
  }
}

export type IAppleStoreKitComponent = {
  verifyTransaction(jws: string): Promise<VerifiedTransaction>
  verifyNotification(signedPayload: string): Promise<DecodedNotification>
}

// Reads `environment` from a JWS payload WITHOUT verifying — only used to pick
// which (already trusted) verifier to run. The actual security comes from the
// verifier, never from this peek.
function peekEnvironment(jws: string): string | undefined {
  const parts = jws.split('.')
  if (parts.length !== 3) return undefined
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    const env = payload?.environment ?? payload?.data?.environment
    return typeof env === 'string' ? env : undefined
  } catch {
    return undefined
  }
}

export async function createAppleStoreKitComponent({
  config,
  logs
}: Pick<AppComponents, 'config' | 'logs'>): Promise<IAppleStoreKitComponent> {
  const logger = logs.getLogger('apple-storekit')

  const bundleId = (await config.getString('IAP_APPLE_BUNDLE_ID')) || 'org.decentraland.godotexplorer'
  // appAppleId is REQUIRED to construct a Production verifier and omitted for
  // Sandbox. If it's not configured we simply can't verify Production JWS —
  // fine for sandbox-only testing.
  const appAppleIdRaw = (await config.getString('IAP_APPLE_APP_APPLE_ID')) || ''
  const appAppleId = appAppleIdRaw ? Number(appAppleIdRaw) : undefined
  // Online checks = OCSP revocation + current-date validity. Recommended in
  // production; off by default elsewhere so local/sandbox runs don't depend on
  // reaching Apple's OCSP responder.
  const deployEnv = (await config.getString('ENV')) || ''
  const onlineChecksRaw = (await config.getString('IAP_ENABLE_ONLINE_CHECKS')) || ''
  const enableOnlineChecks = onlineChecksRaw ? onlineChecksRaw === 'true' : deployEnv === 'prd'

  const verifiers = new Map<string, SignedDataVerifier>()
  verifiers.set(
    Environment.SANDBOX,
    new SignedDataVerifier(APPLE_STOREKIT_ROOT_CERTS, enableOnlineChecks, Environment.SANDBOX, bundleId)
  )
  if (appAppleId !== undefined && Number.isFinite(appAppleId)) {
    verifiers.set(
      Environment.PRODUCTION,
      new SignedDataVerifier(APPLE_STOREKIT_ROOT_CERTS, enableOnlineChecks, Environment.PRODUCTION, bundleId, appAppleId)
    )
  } else {
    logger.warn('IAP_APPLE_APP_APPLE_ID not set — Production StoreKit verification is disabled (sandbox-only)')
  }

  logger.info('apple-storekit verifier ready', {
    bundleId,
    environments: [...verifiers.keys()].join(','),
    enableOnlineChecks: String(enableOnlineChecks)
  })

  // Runs `op` against the verifier for `env`; falls back to trying every
  // verifier when the environment couldn't be peeked. Wraps the library's
  // VerificationException into our typed error.
  async function withVerifier<T>(env: string | undefined, op: (v: SignedDataVerifier) => Promise<T>): Promise<T> {
    const ordered: SignedDataVerifier[] = []
    if (env && verifiers.has(env)) ordered.push(verifiers.get(env)!)
    for (const v of verifiers.values()) if (!ordered.includes(v)) ordered.push(v)

    let lastErr: unknown
    for (const v of ordered) {
      try {
        return await op(v)
      } catch (e) {
        lastErr = e
        if (e instanceof VerificationException) continue
        throw e
      }
    }
    if (lastErr instanceof VerificationException) {
      throw new StoreKitVerificationError('VERIFICATION_FAILED', `JWS verification failed: ${lastErr.status}`)
    }
    throw new StoreKitVerificationError('VERIFICATION_FAILED', `JWS verification failed: ${String(lastErr)}`)
  }

  function normalizeTransaction(p: {
    transactionId?: string
    originalTransactionId?: string
    productId?: string
    appAccountToken?: string
    environment?: string
    bundleId?: string
    purchaseDate?: number
    type?: string
  }): VerifiedTransaction {
    if (!p.transactionId || !p.productId || !p.purchaseDate) {
      throw new StoreKitVerificationError('MALFORMED_TRANSACTION', 'verified transaction missing required fields')
    }
    return {
      transactionId: p.transactionId,
      originalTransactionId: p.originalTransactionId || p.transactionId,
      productId: p.productId,
      appAccountToken: p.appAccountToken,
      environment: String(p.environment ?? ''),
      bundleId: p.bundleId ?? bundleId,
      purchaseDate: new Date(p.purchaseDate),
      type: p.type ? String(p.type) : undefined
    }
  }

  async function verifyTransaction(jws: string): Promise<VerifiedTransaction> {
    if (typeof jws !== 'string' || jws.length === 0) {
      throw new StoreKitVerificationError('EMPTY_JWS', 'empty jwsRepresentation')
    }
    const env = peekEnvironment(jws)
    const decoded = await withVerifier(env, (v) => v.verifyAndDecodeTransaction(jws))
    return normalizeTransaction(decoded)
  }

  async function verifyNotification(signedPayload: string): Promise<DecodedNotification> {
    if (typeof signedPayload !== 'string' || signedPayload.length === 0) {
      throw new StoreKitVerificationError('EMPTY_JWS', 'empty signedPayload')
    }
    const env = peekEnvironment(signedPayload)
    const decoded = await withVerifier(env, (v) => v.verifyAndDecodeNotification(signedPayload))

    const result: DecodedNotification = {
      notificationType: String(decoded.notificationType ?? ''),
      subtype: decoded.subtype ? String(decoded.subtype) : undefined,
      notificationUUID: decoded.notificationUUID,
      environment: String(decoded.data?.environment ?? '')
    }
    // Verify+decode the embedded transaction JWS, if any.
    const signedTx = decoded.data?.signedTransactionInfo
    if (signedTx) {
      result.transaction = await verifyTransaction(signedTx)
      if (!result.environment) result.environment = result.transaction.environment
    }
    return result
  }

  return { verifyTransaction, verifyNotification }
}
