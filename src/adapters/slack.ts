import { IFetchComponent } from '@well-known-components/interfaces'
import { AuthChain } from '@dcl/crypto'
import { AppComponents } from '../types'

export type ISlackComponent = {
  sendDeletionRequestNotification(userAddress: string, authChain: AuthChain): Promise<void>
  sendCancellationNotification(userAddress: string, authChain: AuthChain): Promise<void>
}

export async function createSlackComponent({
  config,
  fetch,
  logs
}: Pick<AppComponents, 'config' | 'fetch' | 'logs'>): Promise<ISlackComponent> {
  const logger = logs.getLogger('slack')
  const botToken = await config.getString('SLACK_BOT_TOKEN')
  const channelId = await config.getString('SLACK_CHANNEL_ID')

  const SLACK_API_URL = 'https://slack.com/api/chat.postMessage'

  async function sendMessage(text: string): Promise<string | null> {
    if (!botToken || !channelId) {
      logger.warn('SLACK_BOT_TOKEN or SLACK_CHANNEL_ID not configured, skipping notification')
      return null
    }

    try {
      const response = await fetch.fetch(SLACK_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${botToken}`
        },
        body: JSON.stringify({
          channel: channelId,
          text
        })
      })

      const data = await response.json() as { ok: boolean; ts?: string; error?: string }

      if (!data.ok) {
        logger.error('Failed to send Slack notification', { error: data.error || 'Unknown error' })
        return null
      }

      return data.ts || null
    } catch (error) {
      logger.error('Error sending Slack notification', { error: (error as Error).message })
      return null
    }
  }

  async function sendThreadReply(text: string, threadTs: string): Promise<void> {
    if (!botToken || !channelId) {
      return
    }

    try {
      const response = await fetch.fetch(SLACK_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${botToken}`
        },
        body: JSON.stringify({
          channel: channelId,
          text,
          thread_ts: threadTs
        })
      })

      const data = await response.json() as { ok: boolean; error?: string }

      if (!data.ok) {
        logger.error('Failed to send Slack thread reply', { error: data.error || 'Unknown error' })
      }
    } catch (error) {
      logger.error('Error sending Slack thread reply', { error: (error as Error).message })
    }
  }

  function formatAuthChain(authChain: AuthChain): string {
    return '```' + JSON.stringify(authChain, null, 2) + '```'
  }

  async function sendDeletionRequestNotification(userAddress: string, authChain: AuthChain): Promise<void> {
    const mainMessage = [
      `:wastebasket: *Account deletion requested*`,
      `Address: \`${userAddress}\``
    ].join('\n')

    const threadTs = await sendMessage(mainMessage)

    if (threadTs) {
      const authChainMessage = [
        `:white_check_mark: *Authchain validated*`,
        formatAuthChain(authChain)
      ].join('\n')
      await sendThreadReply(authChainMessage, threadTs)
    }
  }

  async function sendCancellationNotification(userAddress: string, authChain: AuthChain): Promise<void> {
    const mainMessage = [
      `:no_entry_sign: *Account deletion cancelled*`,
      `Address: \`${userAddress}\``
    ].join('\n')

    const threadTs = await sendMessage(mainMessage)

    if (threadTs) {
      const authChainMessage = [
        `:white_check_mark: *Authchain validated*`,
        formatAuthChain(authChain)
      ].join('\n')
      await sendThreadReply(authChainMessage, threadTs)
    }
  }

  return {
    sendDeletionRequestNotification,
    sendCancellationNotification
  }
}
