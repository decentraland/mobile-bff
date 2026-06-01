import { DecentralandSignatureContext } from '@dcl/platform-crypto-middleware'
import { HandlerContextWithPath } from '../../../types'
import { MAX_DAILY_CREDITS, MAX_TOTAL_CREDITS } from '../../../logic/iap'

// GET /iap/balance — current credit balance for the authenticated wallet
// (signed fetch -> wallet). Backs the client's `_async_fetch_balance`.
export async function iapBalanceHandler(
  context: HandlerContextWithPath<'iapDb', '/iap/balance'> & DecentralandSignatureContext<any>
) {
  const {
    components: { iapDb },
    verification
  } = context

  const wallet = verification?.auth
  if (!wallet) {
    return { status: 401, body: { ok: false, error: 'Unauthorized' } }
  }

  const { balance, dailyConsumed } = await iapDb.getBalance(wallet)

  return {
    status: 200,
    body: {
      ok: true,
      data: {
        balance,
        dailyConsumed,
        maxTotal: MAX_TOTAL_CREDITS,
        maxDaily: MAX_DAILY_CREDITS
      }
    }
  }
}
