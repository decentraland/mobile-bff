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
//
// `body` is a Buffer of the exact upstream bytes (or our locally-crafted
// JSON on error). The handler returns it as-is and wkc http-server writes
// Buffers verbatim, so the wire payload is byte-identical to upstream and
// the framework never re-encodes it.

import { AppComponents } from '../types'

const DEFAULT_UPSTREAM = 'https://api.thirdweb.com/v1/wallets/sign-message'
const UPSTREAM_TIMEOUT_MS = 5_000

export type ThirdwebProxyResponse = {
  status: number
  contentType: string | null
  body: Buffer
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

  function jsonError(status: number, message: string): ThirdwebProxyResponse {
    return {
      status,
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify({ error: message }), 'utf8')
    }
  }

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
        body: rawBody,
        // Hard cap — without this a hung upstream pins a request slot
        // indefinitely. The wkc fetch component aborts and throws when this
        // fires, which is caught below.
        timeout: UPSTREAM_TIMEOUT_MS
      } as any)
      const bodyBytes = Buffer.from(await upstream.arrayBuffer())
      if (upstream.status >= 500) {
        logger.warn('upstream 5xx', {
          status: upstream.status,
          bodyPreview: bodyBytes.toString('utf8').slice(0, 200)
        })
        return jsonError(502, 'upstream temporarily unavailable')
      }
      return { status: upstream.status, contentType: upstream.headers.get('content-type'), body: bodyBytes }
    } catch (err: any) {
      logger.error('upstream request failed', { error: err?.message || String(err) })
      return jsonError(502, 'upstream request failed')
    }
  }

  return { forwardSignMessage }
}
