import { AuthChain } from '@dcl/crypto'
import { createSlackComponent } from '../../../src/adapters/slack'
import { createConfigJestMockComponent } from '../../mocks/config-mock'
import { createFetchMockComponent, createMockResponse } from '../../mocks/fetch-mock'
import { createLogsMockComponent } from '../../mocks/logs-mock'

describe('slack adapter — deletion notification formatting', () => {
  const ADDRESS = '0x1234567890123456789012345678901234567890'
  const AUTH_CHAIN: AuthChain = [
    { type: 'SIGNER', payload: ADDRESS, signature: '' }
  ] as AuthChain

  function setup() {
    const config = createConfigJestMockComponent({ SLACK_BOT_TOKEN: 'https://hooks.slack/x' })
    const fetch = createFetchMockComponent()
    const logs = createLogsMockComponent()
    fetch.fetch.mockResolvedValue(createMockResponse({}))
    return { config, fetch, logs }
  }

  function lastMessageText(fetch: ReturnType<typeof createFetchMockComponent>): string {
    const lastCall = fetch.fetch.mock.calls[fetch.fetch.mock.calls.length - 1]
    const body = JSON.parse((lastCall[1] as any).body as string)
    return body.text as string
  }

  it('omits the Magic line for non-Magic users (status: not_found)', async () => {
    const { config, fetch, logs } = setup()
    const slack = await createSlackComponent({ config, fetch, logs })

    await slack.sendDeletionRequestNotification(ADDRESS, AUTH_CHAIN, { status: 'not_found' })

    const text = lastMessageText(fetch)
    expect(text).toContain('Account deletion requested')
    expect(text).toContain(ADDRESS)
    expect(text).toContain('Authchain validated')
    expect(text).not.toMatch(/magic/i)
  })

  it('includes the Magic line when the deletion was processed', async () => {
    const { config, fetch, logs } = setup()
    const slack = await createSlackComponent({ config, fetch, logs })

    await slack.sendDeletionRequestNotification(ADDRESS, AUTH_CHAIN, {
      status: 'processed',
      email: 'user@example.com'
    })

    const text = lastMessageText(fetch)
    expect(text).toContain('Magic deletion processed automatically')
    expect(text).toContain('user@example.com')
  })

  it('includes the Magic line when the deletion errored, so the team is alerted', async () => {
    const { config, fetch, logs } = setup()
    const slack = await createSlackComponent({ config, fetch, logs })

    await slack.sendDeletionRequestNotification(ADDRESS, AUTH_CHAIN, {
      status: 'error',
      error: 'HTTP 500'
    })

    const text = lastMessageText(fetch)
    expect(text).toContain('Magic deletion failed')
    expect(text).toContain('HTTP 500')
    expect(text).toContain('Manual deletion required')
  })

  it('falls back to the original message when no Magic result is supplied', async () => {
    const { config, fetch, logs } = setup()
    const slack = await createSlackComponent({ config, fetch, logs })

    await slack.sendDeletionRequestNotification(ADDRESS, AUTH_CHAIN)

    const text = lastMessageText(fetch)
    expect(text).toContain('Account deletion requested')
    expect(text).not.toMatch(/magic/i)
  })
})
