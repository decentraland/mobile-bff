import { AppComponents } from '../types'

export type MagicDeletionStatus = 'processed' | 'not_found' | 'error'

export type MagicDeletionResult = {
  status: MagicDeletionStatus
  email?: string
  error?: string
}

export type IMagicComponent = {
  requestDeletion(publicAddress: string): Promise<MagicDeletionResult>
}

const MAGIC_API_BASE = 'https://api.magic.link'

export async function createMagicComponent({
  config,
  fetch,
  logs
}: Pick<AppComponents, 'config' | 'fetch' | 'logs'>): Promise<IMagicComponent> {
  const logger = logs.getLogger('magic')
  const secretKey = await config.requireString('MAGIC_SECRET_KEY')
  const apiBase = (await config.getString('MAGIC_API_BASE')) || MAGIC_API_BASE

  async function getEmail(publicAddress: string): Promise<string | undefined> {
    const url = `${apiBase}/v2/admin/auth/user/get?type=public_address&value=${encodeURIComponent(publicAddress)}`
    const response = await fetch.fetch(url, {
      method: 'GET',
      headers: {
        'X-Magic-Secret-Key': secretKey,
        'Content-Type': 'application/json'
      }
    })

    if (response.status === 404) return undefined
    if (!response.ok) {
      logger.warn('Magic user lookup failed', { status: response.status, publicAddress })
      return undefined
    }

    const body = (await response.json()) as { data?: { email?: string } }
    return body?.data?.email
  }

  async function requestDeletion(publicAddress: string): Promise<MagicDeletionResult> {
    let email: string | undefined
    try {
      email = await getEmail(publicAddress)
    } catch (error) {
      logger.warn('Magic user lookup threw', {
        error: (error as Error).message,
        publicAddress
      })
    }

    try {
      const response = await fetch.fetch(`${apiBase}/v1/admin/user/deletion/request`, {
        method: 'POST',
        headers: {
          'X-Magic-Secret-Key': secretKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ public_addresses: [publicAddress] })
      })

      if (!response.ok) {
        logger.error('Magic deletion request failed', {
          status: response.status,
          publicAddress
        })
        return { status: 'error', email, error: `HTTP ${response.status}` }
      }

      const body = (await response.json()) as {
        processed?: string[]
        unprocessed?: string[]
      }

      const processed = (body.processed || []).map((a) => a.toLowerCase())
      const target = publicAddress.toLowerCase()

      if (processed.includes(target)) {
        logger.info('Magic deletion processed', { publicAddress, email: email ?? '' })
        return { status: 'processed', email }
      }

      logger.info('Magic deletion: address not found at Magic', { publicAddress })
      return { status: 'not_found' }
    } catch (error) {
      const message = (error as Error).message
      logger.error('Magic deletion request threw', { error: message, publicAddress })
      return { status: 'error', email, error: message }
    }
  }

  return { requestDeletion }
}
