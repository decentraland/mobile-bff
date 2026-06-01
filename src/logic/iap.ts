// IAP credit catalog and limits. MUST stay in sync with the iOS client's
// `iap_manager.gd` (`PRODUCT_IDS`, `_CREDITS_BY_PRODUCT`, `_MAX_CREDITS`,
// `_MAX_DAILY_CREDITS`). The server is authoritative — the client values are a
// UX convenience, these are the ones that gate real grants.

// productId -> credits granted. An id absent from this map is unknown and is
// rejected (no product => no grant).
export const CREDITS_BY_PRODUCT: Readonly<Record<string, number>> = {
  credits_10: 10,
  credits_20: 20,
  credits_50: 50
}

// Hard ceiling on a wallet's total balance. A purchase that would push the
// balance above this is denied at the pre-purchase quote (so StoreKit never
// charges). See the note in quote-handler about why we cannot enforce this
// post-charge for a consumable.
export const MAX_TOTAL_CREDITS = 1000

// Max credits a wallet can purchase within a rolling/calendar day.
export const MAX_DAILY_CREDITS = 100

export function creditsForProduct(productId: string): number {
  return CREDITS_BY_PRODUCT[productId] ?? 0
}

export function isKnownProduct(productId: string): boolean {
  return Object.prototype.hasOwnProperty.call(CREDITS_BY_PRODUCT, productId)
}

export type LimitDecision = {
  allowed: boolean
  // Machine-readable reason when denied, for the client to branch on.
  reason?: 'unknown_product' | 'total_limit' | 'daily_limit'
  credits: number
  // Remaining headroom AFTER a hypothetical grant is NOT applied — these are
  // the current headroom values so the client can show "x left today".
  totalRemaining: number
  dailyRemaining: number
}

// Pure limit check shared by the pre-purchase quote and the post-purchase
// re-check. `balance` and `dailyConsumed` come from the DB.
export function evaluatePurchase(input: {
  productId: string
  balance: number
  dailyConsumed: number
}): LimitDecision {
  const credits = creditsForProduct(input.productId)
  const totalRemaining = Math.max(0, MAX_TOTAL_CREDITS - input.balance)
  const dailyRemaining = Math.max(0, MAX_DAILY_CREDITS - input.dailyConsumed)

  if (credits <= 0) {
    return { allowed: false, reason: 'unknown_product', credits: 0, totalRemaining, dailyRemaining }
  }
  if (input.balance + credits > MAX_TOTAL_CREDITS) {
    return { allowed: false, reason: 'total_limit', credits, totalRemaining, dailyRemaining }
  }
  if (input.dailyConsumed + credits > MAX_DAILY_CREDITS) {
    return { allowed: false, reason: 'daily_limit', credits, totalRemaining, dailyRemaining }
  }
  return { allowed: true, credits, totalRemaining, dailyRemaining }
}
