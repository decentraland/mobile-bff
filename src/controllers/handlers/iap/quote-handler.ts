import { DecentralandSignatureContext } from '@dcl/platform-crypto-middleware'
import { HandlerContextWithPath } from '../../../types'
import { evaluatePurchase } from '../../../logic/iap'

type QuoteBody = {
  productId?: string
}

// POST /iap/apple/quote — the PRE-PURCHASE gate (signed fetch -> wallet).
//
// This is where the daily and total-balance limits are actually enforced. The
// client MUST call this and only initiate the StoreKit purchase when
// `allowed: true`. Why here and not at verification time: credits are a
// CONSUMABLE — once StoreKit completes the purchase, Apple has already charged
// the user and there is no server-side way to un-charge a consumable. Refusing
// to credit a paid transaction would mean "charged, got nothing". So the gate
// has to run before the charge.
export async function iapQuoteHandler(
  context: HandlerContextWithPath<'iapDb' | 'logs', '/iap/apple/quote'> & DecentralandSignatureContext<any>
) {
  const {
    components: { iapDb, logs },
    verification,
    request
  } = context

  const logger = logs.getLogger('iap-quote')
  const wallet = verification?.auth
  if (!wallet) {
    return { status: 401, body: { ok: false, error: 'Unauthorized' } }
  }

  let body: QuoteBody
  try {
    body = (await request.json()) as QuoteBody
  } catch {
    return { status: 400, body: { ok: false, error: 'Invalid JSON body' } }
  }

  const productId = body.productId
  if (typeof productId !== 'string' || productId.length === 0) {
    return { status: 400, body: { ok: false, error: 'productId is required' } }
  }

  const { balance, dailyConsumed } = await iapDb.getBalance(wallet)
  const decision = evaluatePurchase({ productId, balance, dailyConsumed })

  logger.info('quote', {
    wallet,
    productId,
    allowed: String(decision.allowed),
    reason: decision.reason ?? '',
    balance,
    dailyConsumed
  })

  return {
    status: 200,
    body: {
      ok: true,
      data: {
        allowed: decision.allowed,
        reason: decision.reason ?? null,
        credits: decision.credits,
        balance,
        totalRemaining: decision.totalRemaining,
        dailyRemaining: decision.dailyRemaining
      }
    }
  }
}
