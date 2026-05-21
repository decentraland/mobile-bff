import { createTestMetricsComponent } from '@well-known-components/metrics'

import { createThirdwebProxyComponent } from '../../src/adapters/thirdweb-proxy'
import { metricDeclarations } from '../../src/metrics'
import { createConfigJestMockComponent } from '../mocks/config-mock'
import { createFetchMockComponent } from '../mocks/fetch-mock'
import { createLogsMockComponent } from '../mocks/logs-mock'

function buildUpstream({
  status,
  body,
  contentType = 'application/json'
}: {
  status: number
  body: string | Buffer
  contentType?: string | null
}): any {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8')
  return {
    status,
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? contentType : null) },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  }
}

async function build({
  fetchImpl
}: {
  fetchImpl: (...args: any[]) => any
}) {
  const config = createConfigJestMockComponent({
    THIRDWEB_SECRET_KEY: 'sk-test',
    THIRDWEB_CLIENT_ID: 'client-test',
    THIRDWEB_API_BASE_URL: 'https://upstream.example/v1/wallets/sign-message'
  })
  const fetch = createFetchMockComponent()
  fetch.fetch.mockImplementation(fetchImpl)
  const logs = createLogsMockComponent()
  const metrics = createTestMetricsComponent(metricDeclarations)
  const proxy = await createThirdwebProxyComponent({ config, fetch, logs, metrics } as any)
  return { proxy, fetch, metrics }
}

describe('thirdweb-proxy', () => {
  const baseInput = { authorization: 'Bearer test-jwt', rawBody: Buffer.from('{"foo":1}') }

  it('forwards 2xx upstream body byte-for-byte', async () => {
    const upstreamBody = Buffer.from('{"signature":"0xdeadbeef","extra":"keep me"}')
    const { proxy } = await build({
      fetchImpl: async () => buildUpstream({ status: 200, body: upstreamBody })
    })
    const res = await proxy.forwardSignMessage(baseInput)
    expect(res.status).toBe(200)
    expect(res.contentType).toBe('application/json')
    expect(res.body.equals(upstreamBody)).toBe(true)
  })

  it('passes the user JWT and injects x-secret-key + x-client-id', async () => {
    let captured: any = null
    const { proxy } = await build({
      fetchImpl: async (_url: string, opts: any) => {
        captured = opts
        return buildUpstream({ status: 200, body: '{}' })
      }
    })
    await proxy.forwardSignMessage(baseInput)
    expect(captured.headers.Authorization).toBe('Bearer test-jwt')
    expect(captured.headers['x-secret-key']).toBe('sk-test')
    expect(captured.headers['x-client-id']).toBe('client-test')
    expect(captured.body).toBe(baseInput.rawBody)
    expect(captured.timeout).toBeGreaterThan(0)
  })

  it('sanitizes 4xx upstream bodies, keeping only allowed fields', async () => {
    const dirty = {
      error: 'bad chain id',
      code: 'INVALID_CHAIN',
      message: 'chain 1234 not supported',
      requestId: 'tw-req-abc-123',
      trace: { internal: 'leak me' }
    }
    const { proxy } = await build({
      fetchImpl: async () => buildUpstream({ status: 400, body: JSON.stringify(dirty) })
    })
    const res = await proxy.forwardSignMessage(baseInput)
    expect(res.status).toBe(400)
    const parsed = JSON.parse(res.body.toString('utf8'))
    expect(parsed).toEqual({
      error: 'bad chain id',
      code: 'INVALID_CHAIN',
      message: 'chain 1234 not supported'
    })
    expect(parsed.requestId).toBeUndefined()
    expect(parsed.trace).toBeUndefined()
  })

  it('replaces non-JSON 4xx bodies with a generic error shape', async () => {
    const { proxy } = await build({
      fetchImpl: async () => buildUpstream({ status: 429, body: '<html>rate limit hit</html>' })
    })
    const res = await proxy.forwardSignMessage(baseInput)
    expect(res.status).toBe(429)
    const parsed = JSON.parse(res.body.toString('utf8'))
    expect(parsed).toEqual({ error: 'upstream rejected request' })
  })

  it('replaces 5xx bodies with 502 and a generic message', async () => {
    const { proxy } = await build({
      fetchImpl: async () =>
        buildUpstream({ status: 503, body: 'internal stack trace: at /handler/foo:42' })
    })
    const res = await proxy.forwardSignMessage(baseInput)
    expect(res.status).toBe(502)
    expect(JSON.parse(res.body.toString('utf8'))).toEqual({ error: 'upstream temporarily unavailable' })
  })

  it('maps a synthetic 408 (upstream timeout) to 504 with code UPSTREAM_TIMEOUT', async () => {
    const { proxy, metrics } = await build({
      fetchImpl: async () => buildUpstream({ status: 408, body: '' })
    })
    const res = await proxy.forwardSignMessage(baseInput)
    expect(res.status).toBe(504)
    expect(res.contentType).toBe('application/json')
    const parsed = JSON.parse(res.body.toString('utf8'))
    expect(parsed).toEqual({ error: 'upstream timed out', code: 'UPSTREAM_TIMEOUT' })
    const counter = await metrics.getValue('thirdweb_proxy_requests_total')
    expect(counter.values.some((v: any) => v.labels.status_class === 'timeout' && v.value === 1)).toBe(true)
  })

  it('returns 502 when the fetch call throws', async () => {
    const { proxy, metrics } = await build({
      fetchImpl: async () => {
        throw new Error('ENETUNREACH')
      }
    })
    const res = await proxy.forwardSignMessage(baseInput)
    expect(res.status).toBe(502)
    expect(JSON.parse(res.body.toString('utf8')).error).toBe('upstream request failed')
    const counter = await metrics.getValue('thirdweb_proxy_requests_total')
    expect(counter.values.some((v: any) => v.labels.status_class === 'fetch_error')).toBe(true)
  })

  it('emits the upstream status_class metric on a successful call', async () => {
    const { proxy, metrics } = await build({
      fetchImpl: async () => buildUpstream({ status: 200, body: '{}' })
    })
    await proxy.forwardSignMessage(baseInput)
    const counter = await metrics.getValue('thirdweb_proxy_requests_total')
    expect(counter.values.some((v: any) => v.labels.status_class === '2xx' && v.value === 1)).toBe(true)
  })
})
