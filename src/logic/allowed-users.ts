import { IConfigComponent } from '@well-known-components/interfaces'

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
    .filter(addr => addr.length > 0)

  return allowedUsers.includes(userAddress.toLowerCase())
}
