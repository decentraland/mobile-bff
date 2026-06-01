import { DecentralandSignatureContext } from '@dcl/platform-crypto-middleware'
import { HandlerContextWithPath } from '../../../types'
import { appAccountTokenMatchesWallet } from '../../../logic/wallet'
import { creditsForProduct, isKnownProduct, MAX_TOTAL_CREDITS } from '../../../logic/iap'
import { StoreKitVerificationError } from '../../../adapters/apple-storekit'

type VerifyBody = {
  jwsRepresentation?: string
}

// POST /iap/apple/verify — verify a StoreKit transaction JWS and credit the
// wallet (signed fetch -> wallet). This is the primary crediting path; the
// client posts `Transaction.jwsRepresentation` right after StoreKit completes.
//
// Note on limits: this endpoint does NOT enforce the daily/total caps by
// rejecting — the purchase already went through StoreKit and the user was
// charged (consumable, no server-side un-charge). The caps are enforced at
// /iap/apple/quote BEFORE the charge. Here we always honor a valid, wallet-
// bound, not-yet-seen transaction, and only log loudly if it lands over the
// cap (which should be impossible if the client respected the quote gate).
export async function iapVerifyHandler(
  context: HandlerContextWithPath<'iapDb' | 'appleStoreKit' | 'logs' | 'config', '/iap/apple/verify'> &
    DecentralandSignatureContext<any>
) {
  const {
    components: { iapDb, appleStoreKit, logs, config },
    verification,
    request
  } = context

  const logger = logs.getLogger('iap-verify')
  const wallet = verification?.auth
  if (!wallet) {
    return { status: 401, body: { ok: false, error: 'Unauthorized' } }
  }

  let body: VerifyBody
  try {
    body = (await request.json()) as VerifyBody
  } catch {
    return { status: 400, body: { ok: false, error: 'Invalid JSON body' } }
  }
  const jws = body.jwsRepresentation
  if (typeof jws !== 'string' || jws.length === 0) {
    return { status: 400, body: { ok: false, error: 'jwsRepresentation is required' } }
  }

  // 1. Cryptographic verification against Apple's pinned roots.
  let tx
  try {
    tx = await appleStoreKit.verifyTransaction(jws)
  } catch (e) {
    const code = e instanceof StoreKitVerificationError ? e.code : 'VERIFICATION_FAILED'
    logger.warn('verify failed', { wallet, code, error: (e as Error).message })
    // Permanent rejection (signature/format problem) — retrying the same JWS
    // won't help. Returned as HTTP 200 with retryable:false: the client's
    // request_json treats any non-2xx as a transport error (=> StoreKit retry),
    // so a permanent verdict MUST come back as 200 to stop the redelivery loop.
    return { status: 200, body: { ok: false, retryable: false, error: 'transaction verification failed', code } }
  }

  // 2. Environment guard — never credit a Sandbox transaction on a production
  // deployment. Non-prod accepts both (so TestFlight/sandbox can be tested).
  const deployEnv = (await config.getString('ENV')) || ''
  if (deployEnv === 'prd' && tx.environment !== 'Production') {
    logger.warn('rejecting non-production tx on prd', { wallet, environment: tx.environment, txId: tx.transactionId })
    return { status: 200, body: { ok: false, retryable: false, error: 'wrong environment', code: 'WRONG_ENVIRONMENT' } }
  }

  // 3. Binding: the appAccountToken inside the signed JWS must match the
  // authenticated wallet. This is what stops a stolen JWS from crediting a
  // different account.
  if (!appAccountTokenMatchesWallet(tx.appAccountToken, wallet)) {
    logger.warn('appAccountToken does not match wallet', {
      wallet,
      txId: tx.transactionId,
      hasToken: String(!!tx.appAccountToken)
    })
    return {
      status: 200,
      body: { ok: false, retryable: false, error: 'transaction not bound to this wallet', code: 'WALLET_MISMATCH' }
    }
  }

  // 4. Known product -> credits.
  if (!isKnownProduct(tx.productId)) {
    logger.warn('unknown product', { wallet, productId: tx.productId, txId: tx.transactionId })
    return { status: 200, body: { ok: false, retryable: false, error: 'unknown product', code: 'UNKNOWN_PRODUCT' } }
  }
  const credits = creditsForProduct(tx.productId)

  // 5. Idempotent grant.
  const { inserted } = await iapDb.recordGrant({
    transactionId: tx.transactionId,
    originalTransactionId: tx.originalTransactionId,
    wallet,
    productId: tx.productId,
    credits,
    environment: tx.environment,
    purchaseDate: tx.purchaseDate
  })

  const { balance, dailyConsumed } = await iapDb.getBalance(wallet)

  if (inserted) {
    logger.info('credited', { wallet, productId: tx.productId, credits, txId: tx.transactionId, balance })
    // Defense-in-depth: the quote gate should have prevented this. If it still
    // happened, we honor the payment but flag it for investigation.
    if (balance > MAX_TOTAL_CREDITS) {
      logger.warn('balance over cap after grant (quote gate bypassed?)', {
        wallet,
        balance,
        cap: MAX_TOTAL_CREDITS,
        txId: tx.transactionId
      })
    }
  } else {
    logger.info('duplicate tx, already credited', { wallet, txId: tx.transactionId, balance })
  }

  return {
    status: 200,
    body: {
      ok: true,
      data: {
        granted: inserted,
        alreadyProcessed: !inserted,
        credits,
        balance,
        dailyConsumed
      }
    }
  }
}
