import { createConfigComponent } from '@well-known-components/env-config-provider'
import { isAllowedUser } from '../../src/logic/allowed-users'

const listed = '0x1111111111111111111111111111111111111111'
const denied = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

describe('isAllowedUser', () => {
  it('allows a listed address, case-insensitively', async () => {
    const config = createConfigComponent({ ALLOWED_USERS: listed.toUpperCase() })
    expect(await isAllowedUser(config, listed)).toBe(true)
  })

  it('refuses an address that is not listed', async () => {
    const config = createConfigComponent({ ALLOWED_USERS: listed })
    expect(await isAllowedUser(config, '0x2222222222222222222222222222222222222222')).toBe(false)
  })

  it('refuses a denied address even when it is listed', async () => {
    const config = createConfigComponent({ ALLOWED_USERS: `${denied},${listed}` })
    expect(await isAllowedUser(config, denied)).toBe(false)
    expect(await isAllowedUser(config, listed)).toBe(true)
  })
})
