import { DecentralandSignatureContext } from '@dcl/platform-crypto-middleware'
import { HandlerContextWithPath } from '../../../types'

// GET /iap/history — the authenticated wallet's credit transactions, most
// recent first (signed fetch -> wallet). Backs the credits history view. Each
// entry is { credits, is_refund, timestamp } as the client UI expects.
export async function iapHistoryHandler(
  context: HandlerContextWithPath<'iapDb', '/iap/history'> & DecentralandSignatureContext<any>
) {
  const {
    components: { iapDb },
    verification
  } = context

  const wallet = verification?.auth
  if (!wallet) {
    return { status: 401, body: { ok: false, error: 'Unauthorized' } }
  }

  const transactions = await iapDb.getTransactions(wallet)

  return {
    status: 200,
    body: {
      ok: true,
      data: { transactions }
    }
  }
}
