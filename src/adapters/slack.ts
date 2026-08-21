import { IFetchComponent } from '@dcl/core-commons'
import { AuthChain } from '@dcl/crypto'
import { AppComponents } from '../types'
import { MagicDeletionResult } from './magic'
import { drainResponse } from '../logic/fetch-utils'

export type ISlackComponent = {
  sendDeletionRequestNotification(
    userAddress: string,
    authChain: AuthChain,
    magicResult?: MagicDeletionResult
  ): Promise<void>
  sendCancellationNotification(userAddress: string, authChain: AuthChain): Promise<void>
}

export async function createSlackComponent({
  config,
  fetch,
  logs
}: Pick<AppComponents, 'config' | 'fetch' | 'logs'>): Promise<ISlackComponent> {
  const logger = logs.getLogger('slack')
  // TODO: update this to slack_webhook
  const webhookUrl = await config.getString('SLACK_BOT_TOKEN')

  async function sendMessage(text: string): Promise<void> {
    if (!webhookUrl) {
      logger.warn('SLACK_BOT_TOKEN not configured, skipping notification')
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
      // Fire-and-forget POST: we never read the body on either path, so drain
      // it to release the socket back to the pool.
      await drainResponse(response)
    } catch (error) {
      logger.error('Error sending Slack notification', { error: (error as Error).message })
    }
  }

  function formatAuthChain(authChain: AuthChain): string {
    return '```' + JSON.stringify(authChain, null, 2) + '```'
  }

  function formatMagicResult(result: MagicDeletionResult): string {
    const emailLine = result.email ? `\nEmail: \`${result.email}\`` : ''
    switch (result.status) {
      case 'processed':
        return `:magic_wand: *Magic deletion processed automatically*${emailLine}`
      case 'not_found':
        return `:information_source: *Address not found at Magic* — likely uses a different provider; manual review may be needed.`
      case 'error':
        return `:rotating_light: *Magic deletion failed*: ${result.error ?? 'unknown error'}${emailLine}\nManual deletion required.`
    }
  }

  async function sendDeletionRequestNotification(
    userAddress: string,
    authChain: AuthChain,
    magicResult?: MagicDeletionResult
  ): Promise<void> {
    const lines = [
      `:wastebasket: *Account deletion requested*`,
      `Address: \`${userAddress}\``
    ]
    // Non-Magic users (status: not_found) fall back to the original manual-cleanup flow with no Magic line.
    if (magicResult && magicResult.status !== 'not_found') {
      lines.push('', formatMagicResult(magicResult))
    }
    lines.push('', `:white_check_mark: *Authchain validated*`, formatAuthChain(authChain))
    await sendMessage(lines.join('\n'))
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
