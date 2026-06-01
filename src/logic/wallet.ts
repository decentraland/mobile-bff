import crypto from 'node:crypto'

// Deterministic wallet -> UUID, MUST stay byte-identical to the iOS client's
// `StoreKitManager.appAccountToken(forWallet:)`. The client passes this UUID to
// StoreKit as the purchase's `appAccountToken`, which Apple embeds inside the
// signed JWS. On the server we re-derive it from the authenticated wallet and
// compare against the verified transaction's appAccountToken — that binding is
// what stops a stolen/replayed JWS from crediting a different wallet.
//
// Algorithm (do not "improve" without changing the Swift side in lockstep):
//   input = "dcl-iap:" + wallet.toLowerCase()
//   uuid  = first 16 bytes of SHA256(input), formatted as a canonical UUID.
// Note this is NOT an RFC-4122 v5 UUID — the version/variant bits are left as
// the raw hash bytes, exactly like the Swift `UUID(uuid:)` construction.
export function uuidFromWallet(wallet: string): string {
  const normalized = wallet.toLowerCase()
  const hash = crypto.createHash('sha256').update(`dcl-iap:${normalized}`, 'utf8').digest()
  const hex = hash.subarray(0, 16).toString('hex')
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join('-')
}

// Apple returns appAccountToken as a lowercase UUID string; compare loosely.
export function appAccountTokenMatchesWallet(appAccountToken: string | undefined, wallet: string): boolean {
  if (!appAccountToken) return false
  return appAccountToken.toLowerCase() === uuidFromWallet(wallet)
}
