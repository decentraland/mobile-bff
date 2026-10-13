import { createHash, createPublicKey, generateKeyPairSync, verify } from 'node:crypto'
import {
  buildAccountJwt,
  createSnowflakeComponent,
  mapRows,
  publicKeyFingerprint,
  qualifiedUsername,
  restorePemNewlines
} from '../../../src/adapters/snowflake'

// Nothing here can be checked against Snowflake without the service account's key, so what is
// checked is the half we own: the exact strings Snowflake compares against, computed a second
// way. A wrong fingerprint or a region left in the issuer both fail authentication with the
// same opaque 401, which is the kind of thing that costs an afternoon.
describe('snowflake key-pair auth', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })

  it('strips region and cloud from the account identifier and uppercases both halves', () => {
    expect(qualifiedUsername('gra03234.us-east-1', 'push_feed')).toBe('GRA03234.PUSH_FEED')
    expect(qualifiedUsername('GRA03234', 'PUSH_FEED')).toBe('GRA03234.PUSH_FEED')
  })

  it('fingerprints the public half the way DESCRIBE USER reports it', () => {
    const der = createPublicKey(privateKey).export({ type: 'spki', format: 'der' })
    const expected = `SHA256:${createHash('sha256').update(der).digest('base64')}`

    expect(publicKeyFingerprint(privateKey)).toBe(expected)
  })

  it('signs a JWT whose claims and signature Snowflake would accept', () => {
    const issuedAt = 1_760_000_000
    const token = buildAccountJwt(privateKey, 'gra03234.us-east-1', 'push_feed', issuedAt, 3600)

    const [header, claims, signature] = token.split('.')
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' })
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toEqual({
      iss: `GRA03234.PUSH_FEED.${publicKeyFingerprint(privateKey)}`,
      sub: 'GRA03234.PUSH_FEED',
      iat: issuedAt,
      exp: issuedAt + 3600
    })

    const verified = verify(
      'sha256',
      Buffer.from(`${header}.${claims}`),
      createPublicKey(privateKey),
      Buffer.from(signature, 'base64url')
    )
    expect(verified).toBe(true)
  })

  it('rebuilds a PEM whose newlines a secret store collapsed', () => {
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    const collapsed = pem.replace(/\n/g, '')

    // The round trip has to produce a key that still parses, which is the only property that
    // matters — exact line breaks are not something the PEM grammar fixes.
    expect(restorePemNewlines(collapsed).replace(/\s/g, '')).toBe(pem.replace(/\s/g, ''))
    expect(restorePemNewlines(pem)).toBe(pem.trim())
  })
})

describe('snowflake result mapping', () => {
  it('names columns case-insensitively and keeps a null as null', () => {
    const rows = mapRows(
      { rowType: [{ name: 'CAMPAIGN_KEY' }, { name: 'IMAGE_URL' }] },
      [
        ['d3-comeback', 'https://example.com/a.png'],
        ['d30-comeback', null]
      ]
    )

    expect(rows).toEqual([
      { campaign_key: 'd3-comeback', image_url: 'https://example.com/a.png' },
      { campaign_key: 'd30-comeback', image_url: null }
    ])
  })

  it('reads a short row as nulls rather than undefined', () => {
    expect(mapRows({ rowType: [{ name: 'A' }, { name: 'B' }] }, [['only']])).toEqual([{ a: 'only', b: null }])
  })
})

describe('snowflake component', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const ENV: Record<string, string> = {
    SNOWFLAKE_ACCOUNT: 'gra03234.us-east-1',
    SNOWFLAKE_USER: 'push_feed',
    SNOWFLAKE_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  }

  function component(fetchImpl: jest.Mock, env: Record<string, string> = ENV) {
    return createSnowflakeComponent({
      fetch: { fetch: fetchImpl } as any,
      config: { getString: async (key: string) => env[key] } as any,
      logs: { getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }) } as any
    })
  }

  const reply = (status: number, body: unknown) => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body
  })
  const RESULT = { resultSetMetaData: { rowType: [{ name: 'VISITOR_ID' }] }, data: [['alice']] }
  const HOST = 'https://gra03234.us-east-1.snowflakecomputing.com'

  afterEach(() => {
    jest.useRealTimers()
  })

  it('posts the statement to the account host with the key-pair bearer', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(reply(200, RESULT))
    const snowflake = await component(fetchImpl)

    expect(await snowflake.query('SELECT 1')).toEqual([{ visitor_id: 'alice' }])
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toMatch(new RegExp(`^${HOST}/api/v2/statements\\?requestId=`))
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toMatch(/^Bearer /)
    expect(init.headers['X-Snowflake-Authorization-Token-Type']).toBe('KEYPAIR_JWT')
    expect(JSON.parse(init.body)).toMatchObject({ statement: 'SELECT 1' })
  })

  // 202 is "still running", which a warehouse resuming from suspension produces. Read as "no
  // result set", it was an empty feed and a day with nothing queued.
  it('waits for a statement that is still running instead of reading it as empty', async () => {
    jest.useFakeTimers()
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(reply(202, { statementHandle: 'h-1' }))
      .mockResolvedValueOnce(reply(202, { statementHandle: 'h-1' }))
      .mockResolvedValueOnce(reply(200, RESULT))
    const snowflake = await component(fetchImpl)

    const pending = snowflake.query('SELECT 1')
    await jest.advanceTimersByTimeAsync(4_000)

    expect(await pending).toEqual([{ visitor_id: 'alice' }])
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(fetchImpl.mock.calls[1][0]).toBe(`${HOST}/api/v2/statements/h-1`)
    expect(fetchImpl.mock.calls[1][1].method).toBe('GET')
  })

  it('gives up on a statement still running past its own timeout', async () => {
    jest.useFakeTimers()
    const fetchImpl = jest.fn().mockResolvedValue(reply(202, { statementHandle: 'h-1' }))
    const snowflake = await component(fetchImpl)

    const pending = snowflake.query('SELECT 1')
    const failed = expect(pending).rejects.toThrow(/still running/)
    await jest.advanceTimersByTimeAsync(125_000)
    await failed
  })

  it('surfaces a refusal with the status and the message the API gave', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(reply(400, { message: 'SQL compilation error' }))
    const snowflake = await component(fetchImpl)

    await expect(snowflake.query('SELECT 1')).rejects.toThrow(
      'Snowflake rejected the statement: 400 SQL compilation error'
    )
  })

  // The account is the hostname the signed JWT is posted to.
  it('is not configured when the account is not an account identifier', async () => {
    const fetchImpl = jest.fn()
    const snowflake = await component(fetchImpl, { ...ENV, SNOWFLAKE_ACCOUNT: 'evil.example/#' })

    expect(snowflake.isConfigured()).toBe(false)
    await expect(snowflake.query('SELECT 1')).rejects.toThrow('not configured')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
