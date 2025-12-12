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
  const webhookUrl = await config.getString('SLACK_WEBHOOK_URL')

  async function sendMessage(text: string): Promise<void> {
    if (!webhookUrl) {
      logger.warn('SLACK_WEBHOOK_URL not configured, skipping notification')
      return
    }

    try {
      const response = await fetch.fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      })

      if (!response.ok) {
        logger.error('Failed to send Slack notification', { status: response.status })
      }
    } catch (error) {
      logger.error('Error sending Slack notification', { error: (error as Error).message })
    }
  }

  function formatAuthChain(authChain: AuthChain): string {
    return '```' + JSON.stringify(authChain, null, 2) + '```'
  }

  async function sendDeletionRequestNotification(userAddress: string, authChain: AuthChain): Promise<void> {
    const message = [
      `:wastebasket: *Account deletion requested*`,
      `Address: \`${userAddress}\``,
      ``,
      `:white_check_mark: *Authchain validated*`,
      formatAuthChain(authChain)
    ].join('\n')
    await sendMessage(message)
  }

  async function sendCancellationNotification(userAddress: string, authChain: AuthChain): Promise<void> {
    const message = [
      `:no_entry_sign: *Account deletion cancelled*`,
      `Address: \`${userAddress}\``,
      ``,
      `:white_check_mark: *Authchain validated*`,
      formatAuthChain(authChain)
    ].join('\n')
    await sendMessage(message)
  }

  return {
    sendDeletionRequestNotification,
    sendCancellationNotification
  }
}
