import { AuthChain, AuthLink } from '@dcl/crypto'
import { AUTH_CHAIN_HEADER_PREFIX } from '@dcl/platform-crypto-middleware'

export function extractAuthChain(headers: Record<string, string>): AuthChain {
  const authChain: AuthLink[] = []
  let i = 0
  while (headers[`${AUTH_CHAIN_HEADER_PREFIX}${i}`]) {
    try {
      authChain.push(JSON.parse(headers[`${AUTH_CHAIN_HEADER_PREFIX}${i}`]))
    } catch {
      // Skip malformed auth chain entries
      break
    }
    i++
  }
  return authChain
}
