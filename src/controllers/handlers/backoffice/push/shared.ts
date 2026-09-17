import { DecentralandSignatureContext } from '@dcl/crypto-middleware'
import { isAllowedUser } from '../../../../logic/allowed-users'
import { AppComponents } from '../../../../types'

/**
 * Every push endpoint is moderation-gated the same way: a valid signed fetch whose signer is
 * in ALLOWED_USERS. Kept in one place so a new endpoint cannot accidentally ship without it.
 *
 * Returns the caller's address, or the response to send back instead.
 */
export async function requireBackofficeUser(
  config: AppComponents['config'],
  verification: DecentralandSignatureContext<any>['verification']
): Promise<{ address: string } | { response: { status: number; body: { ok: false; error: string } } }> {
  const userAddress = verification?.auth
  if (!userAddress) {
    return { response: { status: 401, body: { ok: false, error: 'Unauthorized' } } }
  }
  if (!(await isAllowedUser(config, userAddress))) {
    return { response: { status: 403, body: { ok: false, error: 'Forbidden: User not in allowed list' } } }
  }
  // Addresses are compared lowercase everywhere else (isAllowedUser lowercases both sides),
  // so store them that way too: created_by and approved_by are compared to each other by the
  // two-man rule, and a checksummed address would not match its own lowercase form.
  return { address: userAddress.toLowerCase() }
}

export function notFound(id: string) {
  return { status: 404, body: { ok: false as const, error: `Push campaign '${id}' not found` } }
}
