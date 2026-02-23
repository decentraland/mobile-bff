import jwt from 'jsonwebtoken'
import { AppComponents } from '../types'

export type IAppStoreConnectComponent = {
  findLatestBuild(): Promise<{ id: string; version: string } | null>
  setBetaBuildWhatsNew(buildId: string, whatsNew: string): Promise<boolean>
}

const ASC_API_BASE = 'https://api.appstoreconnect.apple.com/v1'

export async function createAppStoreConnectComponent({
  config,
  fetch,
  logs
}: Pick<AppComponents, 'config' | 'fetch' | 'logs'>): Promise<IAppStoreConnectComponent> {
  const logger = logs.getLogger('app-store-connect')
  const issuerId = await config.getString('ASC_ISSUER_ID')
  const keyId = await config.getString('ASC_KEY_ID')
  const privateKey = await config.getString('ASC_PRIVATE_KEY')
  const appId = await config.getString('ASC_APP_ID')

  function isConfigured(): boolean {
    return !!(issuerId && keyId && privateKey && appId)
  }

  function generateToken(): string {
    if (!issuerId || !keyId || !privateKey) {
      throw new Error('App Store Connect API is not configured')
    }

    const now = Math.floor(Date.now() / 1000)
    return jwt.sign(
      {
        iss: issuerId,
        iat: now,
        exp: now + 20 * 60,
        aud: 'appstoreconnect-v1'
      },
      privateKey.replace(/\\n/g, '\n'),
      { algorithm: 'ES256', keyid: keyId }
    )
  }

  function getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${generateToken()}`,
      'Content-Type': 'application/json'
    }
  }

  async function findLatestBuild(): Promise<{ id: string; version: string } | null> {
    if (!isConfigured()) {
      logger.warn('App Store Connect API not configured, skipping')
      return null
    }

    try {
      const url =
        `${ASC_API_BASE}/builds` +
        `?filter[app]=${appId}` +
        `&sort=-uploadedDate` +
        `&limit=1` +
        `&fields[builds]=version,uploadedDate,processingState`

      const response = await fetch.fetch(url, { headers: getHeaders() })

      if (!response.ok) {
        logger.error('Failed to fetch builds', { status: response.status })
        return null
      }

      const data = (await response.json()) as {
        data: Array<{ id: string; attributes: { version: string } }>
      }

      if (!data.data || data.data.length === 0) {
        logger.warn('No builds found')
        return null
      }

      const build = data.data[0]
      return { id: build.id, version: build.attributes.version }
    } catch (error) {
      logger.error('Error fetching builds', { error: (error as Error).message })
      return null
    }
  }

  async function setBetaBuildWhatsNew(buildId: string, whatsNew: string): Promise<boolean> {
    if (!isConfigured()) {
      logger.warn('App Store Connect API not configured, skipping')
      return false
    }

    try {
      const response = await fetch.fetch(`${ASC_API_BASE}/betaBuildLocalizations`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          data: {
            type: 'betaBuildLocalizations',
            attributes: {
              locale: 'en-US',
              whatsNew
            },
            relationships: {
              build: {
                data: { type: 'builds', id: buildId }
              }
            }
          }
        })
      })

      if (response.status === 409) {
        logger.info('Beta build localization already exists, updating via PATCH')
        return await updateExistingLocalization(buildId, whatsNew)
      }

      if (!response.ok) {
        const body = await response.text()
        logger.error('Failed to set beta build whats new', { status: response.status, body })
        return false
      }

      return true
    } catch (error) {
      logger.error('Error setting beta build whats new', { error: (error as Error).message })
      return false
    }
  }

  async function updateExistingLocalization(buildId: string, whatsNew: string): Promise<boolean> {
    try {
      const listUrl =
        `${ASC_API_BASE}/builds/${buildId}/betaBuildLocalizations`

      const listResponse = await fetch.fetch(listUrl, { headers: getHeaders() })

      if (!listResponse.ok) {
        logger.error('Failed to list beta build localizations', { status: listResponse.status })
        return false
      }

      const listData = (await listResponse.json()) as {
        data: Array<{ id: string; attributes: { locale: string } }>
      }

      const enLocalization = listData.data.find((l) => l.attributes.locale === 'en-US')
      if (!enLocalization) {
        logger.error('No en-US localization found to update')
        return false
      }

      const patchResponse = await fetch.fetch(`${ASC_API_BASE}/betaBuildLocalizations/${enLocalization.id}`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({
          data: {
            type: 'betaBuildLocalizations',
            id: enLocalization.id,
            attributes: { whatsNew }
          }
        })
      })

      if (!patchResponse.ok) {
        const body = await patchResponse.text()
        logger.error('Failed to update beta build localization', { status: patchResponse.status, body })
        return false
      }

      return true
    } catch (error) {
      logger.error('Error updating beta build localization', { error: (error as Error).message })
      return false
    }
  }

  return {
    findLatestBuild,
    setBetaBuildWhatsNew
  }
}
