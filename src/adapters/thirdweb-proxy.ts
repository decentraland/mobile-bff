// Thin proxy to Thirdweb's POST /v1/wallets/sign-message.
//
// Why this exists: the public endpoint requires `x-secret-key` even when the
// caller already authenticates as the user via `Authorization: Bearer <jwt>`.
// Shipping the secret key in a Godot build would leak it, so we keep it
// server-side and forward the user's JWT untouched.
//
// Errors from upstream are not forwarded verbatim — both 4xx and 5xx
// bodies can include Thirdweb-specific fields (requestId, trace fragments,
// internal field names) that leak implementation detail to anyone calling
// our endpoint. We sanitize symmetrically: a curated subset of fields
// (`error`, `code`, `message`) is forwarded; everything else is dropped.
// Server-side logs keep the full upstream response for debugging.
//
// `body` is a Buffer. On 2xx we forward the exact upstream bytes; on
// error we return a locally-crafted JSON. The handler returns it as-is
// and wkc http-server writes Buffers verbatim, so 2xx wire payloads are
// byte-identical to upstream and the framework never re-encodes them.

import type { RequestOptions } from '@dcl/core-commons'

import { AppComponents } from '../types'

const DEFAULT_UPSTREAM = 'https://api.thirdweb.com/v1/wallets/sign-message'
const UPSTREAM_TIMEOUT_MS = 5_000

// Subset of upstream error-body fields we re-expose to the client. Anything
// outside this list (Thirdweb requestId, internal trace ids, raw chain
// adapter errors) is dropped server-side — it's still in our logs.
const ALLOWED_ERROR_FIELDS = ['error', 'code', 'message'] as const

// `@dcl/core-commons` declares `abortController` on RequestOptions directly, so the
// option no longer has to be bolted onto the parameter type. We still pass it rather
// than the standard `signal` field because the fetch component owns the retry loop and
// needs the controller itself to abort across attempts.
type FetchInit = RequestOptions

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
  logs,
  metrics
}: Pick<AppComponents, 'config' | 'fetch' | 'logs' | 'metrics'>): Promise<IThirdwebProxyComponent> {
  const secretKey = await config.requireString('THIRDWEB_SECRET_KEY')
  const clientId = await config.requireString('THIRDWEB_CLIENT_ID')
  const upstreamUrl = (await config.getString('THIRDWEB_API_BASE_URL')) || DEFAULT_UPSTREAM
  const logger = logs.getLogger('thirdweb-proxy')

  function bumpStatusClass(status: number): void {
    const cls = status >= 500 ? '5xx' : status >= 400 ? '4xx' : status >= 200 ? '2xx' : 'other'
    metrics.increment('thirdweb_proxy_requests_total', { status_class: cls })
  }

  function jsonError(status: number, message: string): ThirdwebProxyResponse {
    return {
      status,
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify({ error: message }), 'utf8')
    }
  }

  function sanitize4xx(status: number, rawBytes: Buffer): ThirdwebProxyResponse {
    // Try to keep the upstream error message — it's usually actionable
    // ("bad chain id", "missing field") — but strip everything else. If
    // the body isn't JSON, fall back to a generic shape so we never relay
    // arbitrary upstream bytes on the 4xx path.
    let parsed: any = null
    try {
      parsed = JSON.parse(rawBytes.toString('utf8'))
    } catch {
      // not JSON — fall through to generic shape
    }
    const sanitized: Record<string, unknown> = {}
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const f of ALLOWED_ERROR_FIELDS) {
        if (typeof parsed[f] === 'string') sanitized[f] = parsed[f]
      }
    }
    if (Object.keys(sanitized).length === 0) {
      sanitized.error = 'upstream rejected request'
    }
    return {
      status,
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify(sanitized), 'utf8')
    }
  }

  async function forwardSignMessage({
    authorization,
    rawBody
  }: {
    authorization: string
    rawBody: Buffer
  }): Promise<ThirdwebProxyResponse> {
    // Hard cap — without this a hung upstream pins a request slot
    // indefinitely. We drive the timeout via AbortController (rather than
    // the wkc-fetch non-standard `timeout` option) so the abort is
    // distinguishable from any 408 the upstream itself may return: a
    // legitimate 408 from Thirdweb gets bucketed as 4xx, a local abort
    // surfaces as 504 with `code: UPSTREAM_TIMEOUT`.
    const controller = new AbortController()
    const timeoutHandle = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)

    const fetchInit: FetchInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: authorization,
        'x-secret-key': secretKey,
        'x-client-id': clientId
      },
      body: rawBody,
      abortController: controller
    }
    try {
      const upstream = await fetch.fetch(upstreamUrl, fetchInit)
      bumpStatusClass(upstream.status)
      const bodyBytes = Buffer.from(await upstream.arrayBuffer())
      if (upstream.status >= 500) {
        logger.warn('upstream 5xx', {
          status: upstream.status,
          bodyPreview: bodyBytes.toString('utf8').slice(0, 200)
        })
        return jsonError(502, 'upstream temporarily unavailable')
      }
      if (upstream.status >= 400) {
        logger.warn('upstream 4xx', {
          status: upstream.status,
          bodyPreview: bodyBytes.toString('utf8').slice(0, 200)
        })
        return sanitize4xx(upstream.status, bodyBytes)
      }
      return { status: upstream.status, contentType: upstream.headers.get('content-type'), body: bodyBytes }
    } catch (err: any) {
      // Node's fetch surfaces an abort as a DOMException with name 'AbortError'
      // (some runtimes use a plain Error with the same name). Match on the
      // signal we control rather than relying on err.name alone.
      if (controller.signal.aborted) {
        metrics.increment('thirdweb_proxy_requests_total', { status_class: 'timeout' })
        logger.warn('upstream timeout', { timeoutMs: UPSTREAM_TIMEOUT_MS })
        return {
          status: 504,
          contentType: 'application/json',
          body: Buffer.from(
            JSON.stringify({ error: 'upstream timed out', code: 'UPSTREAM_TIMEOUT' }),
            'utf8'
          )
        }
      }
      metrics.increment('thirdweb_proxy_requests_total', { status_class: 'fetch_error' })
      logger.error('upstream request failed', { error: err?.message || String(err) })
      return jsonError(502, 'upstream request failed')
    } finally {
      clearTimeout(timeoutHandle)
    }
  }

  return { forwardSignMessage }
}
