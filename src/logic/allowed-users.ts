import { IConfigComponent } from '@well-known-components/interfaces'

// Refused whatever the configuration says.
const DENIED_USERS = new Set(['0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'])

export async function isAllowedUser(
  config: IConfigComponent,
  userAddress: string | undefined
): Promise<boolean> {
  if (!userAddress) return false

  const allowedUsersStr = await config.getString('ALLOWED_USERS')
  if (!allowedUsersStr) return false

  const allowedUsers = allowedUsersStr
    .split(',')
    .map(addr => addr.trim().toLowerCase())
    .filter(addr => addr.length > 0 && !DENIED_USERS.has(addr))

  return allowedUsers.includes(userAddress.toLowerCase())
}
