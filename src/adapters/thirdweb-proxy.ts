// Thin proxy to Thirdweb's POST /v1/wallets/sign-message.
//
// Why this exists: the public endpoint requires `x-secret-key` even when the
// caller already authenticates as the user via `Authorization: Bearer <jwt>`.
// Shipping the secret key in a Godot build would leak it, so we keep it
// server-side and forward the user's JWT untouched.
//
// Errors from upstream are not forwarded verbatim — the body may include
// Thirdweb request ids or trace fragments that we don't want leaking out.
// On 5xx, we return a generic payload to the client and log the upstream
// status + body server-side. On 4xx, we forward upstream's body since it's
// usually actionable (bad chain id, missing field, etc.).

import { AppComponents } from '../types'

const DEFAULT_UPSTREAM = 'https://api.thirdweb.com/v1/wallets/sign-message'

export type ThirdwebProxyResponse = {
  status: number
  contentType: string | null
  body: string
}

export type IThirdwebProxyComponent = {
  forwardSignMessage(input: { authorization: string; rawBody: Buffer }): Promise<ThirdwebProxyResponse>
}

export async function createThirdwebProxyComponent({
  config,
  fetch,
  logs
}: Pick<AppComponents, 'config' | 'fetch' | 'logs'>): Promise<IThirdwebProxyComponent> {
  const secretKey = await config.requireString('THIRDWEB_SECRET_KEY')
  const clientId = await config.requireString('THIRDWEB_CLIENT_ID')
  const upstreamUrl = (await config.getString('THIRDWEB_API_BASE_URL')) || DEFAULT_UPSTREAM
  const logger = logs.getLogger('thirdweb-proxy')

  async function forwardSignMessage({
    authorization,
    rawBody
  }: {
    authorization: string
    rawBody: Buffer
  }): Promise<ThirdwebProxyResponse> {
    try {
      const upstream = await fetch.fetch(upstreamUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: authorization,
          'x-secret-key': secretKey,
          'x-client-id': clientId
        },
        body: rawBody
      })
      const text = await upstream.text()
      if (upstream.status >= 500) {
        logger.warn('upstream 5xx', { status: upstream.status, bodyPreview: text.slice(0, 200) })
        return {
          status: 502,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'upstream temporarily unavailable' })
        }
      }
      return { status: upstream.status, contentType: upstream.headers.get('content-type'), body: text }
    } catch (err: any) {
      logger.error('upstream request failed', { error: err?.message || String(err) })
      return { status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'upstream request failed' }) }
    }
  }

  return { forwardSignMessage }
}
