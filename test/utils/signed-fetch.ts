import {
  AUTH_CHAIN_HEADER_PREFIX,
  AUTH_METADATA_HEADER,
  AUTH_TIMESTAMP_HEADER,
  AuthChain,
  Authenticator,
  AuthIdentity,
  IdentityType
} from '@dcl/crypto'
import { createUnsafeIdentity } from '@dcl/crypto/dist/crypto'

export type Identity = { authChain: AuthIdentity; realAccount: IdentityType; ephemeralIdentity: IdentityType }

export async function getIdentity(): Promise<Identity> {
  const ephemeralIdentity = createUnsafeIdentity()
  const realAccount = createUnsafeIdentity()

  const authChain = await Authenticator.initializeAuthChain(
    realAccount.address,
    ephemeralIdentity,
    10,
    async (message) => {
      return Authenticator.createSignature(realAccount, message)
    }
  )

  return { authChain, realAccount, ephemeralIdentity }
}

function buildHeaders(
  metadataJSON: string,
  timestamp: number,
  payloadToSign: string,
  chainProvider: (payload: string) => AuthChain
) {
  const headers: Record<string, string> = {}
  const chain = chainProvider(payloadToSign)

  chain.forEach((link, index) => {
    headers[`${AUTH_CHAIN_HEADER_PREFIX}${index}`] = JSON.stringify(link)
  })

  headers[AUTH_TIMESTAMP_HEADER] = timestamp.toString()
  headers[AUTH_METADATA_HEADER] = metadataJSON

  return headers
}

/**
 * Signs the current (>= 6.0.0) payload: method, path and timestamp lowercased, metadata joined
 * verbatim. The metadata bytes are inside the signature, so its casing can no longer be changed
 * in flight without invalidating the request.
 */
export function getAuthHeaders(
  method: string,
  path: string,
  metadata: Record<string, any>,
  chainProvider: (payload: string) => AuthChain
) {
  const timestamp = Date.now()
  const metadataJSON = JSON.stringify(metadata)
  const payloadToSign = [method.toLowerCase(), path.toLowerCase(), timestamp.toString(), metadataJSON].join(':')

  return buildHeaders(metadataJSON, timestamp, payloadToSign, chainProvider)
}

/**
 * Signs the pre-6.0.0 payload: the whole joined string folded, metadata included. This is what
 * already-shipped mobile clients send, and what `canonicalMetadataKeys` keeps accepting.
 *
 * Only meaningfully different from {@link getAuthHeaders} when the metadata contains uppercase --
 * otherwise the fold is a no-op and both produce identical bytes.
 */
export function getLegacyAuthHeaders(
  method: string,
  path: string,
  metadata: Record<string, any>,
  chainProvider: (payload: string) => AuthChain
) {
  const timestamp = Date.now()
  const metadataJSON = JSON.stringify(metadata)
  const payloadToSign = [method, path, timestamp.toString(), metadataJSON].join(':').toLowerCase()

  return buildHeaders(metadataJSON, timestamp, payloadToSign, chainProvider)
}
