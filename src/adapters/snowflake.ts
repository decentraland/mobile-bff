// Snowflake over its SQL REST API, no driver: a signed JWT and one POST per statement.
// Spec: https://docs.snowflake.com/en/developer-guide/sql-api/index
//
// The official Node driver would pull in the cloud-storage SDKs of all three providers to
// support bulk unload, which this service never does — it runs one SELECT a day against a
// table of a few hundred rows. Key-pair auth is a 40-line JWT, same as the APNs provider
// token next door.
//
// Every value comes back as a string, and TIMESTAMP columns come back as an epoch offset
// rather than anything readable, so a caller that wants a date renders it to text in SQL and
// parses the text here. `query` deliberately hands back the raw strings instead of guessing.

import { createHash, createPrivateKey, createPublicKey, KeyObject, randomUUID, sign } from 'node:crypto'
import { IFetchComponent } from '@well-known-components/interfaces'
import { AppComponents } from '../types'

// Same reason thirdweb-proxy declares this: the wkc fetch component honors an abortController
// option its public type does not expose, and the node-fetch AbortSignal underneath does not
// line up with the global one, so `signal` does not typecheck.
type FetchInit = Parameters<IFetchComponent['fetch']>[1] & { abortController?: AbortController }

const JWT_TTL_MS = 50 * 60 * 1000
const STATEMENT_TIMEOUT_SECONDS = 120
const REQUEST_TIMEOUT_MS = 180_000
// The API answers 202 for a statement still running after about 45 seconds, which a warehouse
// resuming from suspension can take. How often the result is asked for after that.
const POLL_INTERVAL_MS = 2_000
// The account is the hostname the JWT is posted to, so it is held to the shape of an account
// identifier (`gra03234.us-east-1`): anything else could steer that request, and the key's
// signature with it, somewhere other than Snowflake.
const ACCOUNT_PATTERN = /^[a-z0-9][a-z0-9_.-]*$/i

export type SnowflakeRow = Record<string, string | null>

export type ISnowflakeComponent = {
  /** False when no private key is configured, which is the normal state outside production. */
  isConfigured(): boolean
  query(statement: string): Promise<SnowflakeRow[]>
}

type ResultSetMetaData = {
  rowType: { name: string }[]
  partitionInfo?: { rowCount: number }[]
}

type StatementResponse = {
  resultSetMetaData?: ResultSetMetaData
  data?: (string | null)[][]
  statementHandle?: string
  message?: string
  code?: string
}

type ApiResult = { status: number; ok: boolean; body: StatementResponse }

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

/**
 * Snowflake identifies the key by a fingerprint of its public half, which it compares against
 * the RSA_PUBLIC_KEY it holds for the user. SHA-256 over the DER of the SubjectPublicKeyInfo,
 * base64, prefixed — the same string `DESCRIBE USER` reports as RSA_PUBLIC_KEY_FP.
 */
export function publicKeyFingerprint(privateKey: KeyObject): string {
  const spki = createPublicKey(privateKey).export({ type: 'spki', format: 'der' })
  return `SHA256:${createHash('sha256').update(spki).digest('base64')}`
}

/**
 * The account identifier in the JWT carries neither region nor cloud, even though the
 * hostname does, and both it and the user name are uppercased. `gra03234.us-east-1` plus
 * `push_feed` therefore signs as `GRA03234.PUSH_FEED`.
 */
export function qualifiedUsername(account: string, user: string): string {
  return `${account.split('.')[0].toUpperCase()}.${user.toUpperCase()}`
}

export function buildAccountJwt(
  privateKey: KeyObject,
  account: string,
  user: string,
  issuedAtSeconds: number,
  lifetimeSeconds: number
): string {
  const subject = qualifiedUsername(account, user)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64url(
    JSON.stringify({
      iss: `${subject}.${publicKeyFingerprint(privateKey)}`,
      sub: subject,
      iat: issuedAtSeconds,
      exp: issuedAtSeconds + lifetimeSeconds
    })
  )
  const signingInput = `${header}.${claims}`
  return `${signingInput}.${base64url(sign('sha256', Buffer.from(signingInput), privateKey))}`
}

/** Names the columns of one row, so a caller reads by column instead of by position. */
export function mapRows(metadata: ResultSetMetaData, data: (string | null)[][]): SnowflakeRow[] {
  const names = metadata.rowType.map((column) => column.name.toLowerCase())
  return data.map((values) => {
    const row: SnowflakeRow = {}
    names.forEach((name, index) => {
      row[name] = values[index] ?? null
    })
    return row
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function createSnowflakeComponent({
  config,
  fetch,
  logs
}: Pick<AppComponents, 'config' | 'fetch' | 'logs'>): Promise<ISnowflakeComponent> {
  const logger = logs.getLogger('snowflake')

  const account = (await config.getString('SNOWFLAKE_ACCOUNT')) || ''
  const user = (await config.getString('SNOWFLAKE_USER')) || ''
  const role = (await config.getString('SNOWFLAKE_ROLE')) || ''
  const warehouse = (await config.getString('SNOWFLAKE_WAREHOUSE')) || ''
  const database = (await config.getString('SNOWFLAKE_DATABASE')) || ''
  const schema = (await config.getString('SNOWFLAKE_SCHEMA')) || ''
  const rawPrivateKey = (await config.getString('SNOWFLAKE_PRIVATE_KEY')) || ''

  let privateKey: KeyObject | undefined
  if (rawPrivateKey && account && user) {
    if (!ACCOUNT_PATTERN.test(account)) {
      logger.error('SNOWFLAKE_ACCOUNT is not an account identifier; Snowflake is disabled', { account })
    } else {
      try {
        // The key is the PKCS#8 PEM exactly as the warehouse's Pulumi stack wrote it to SSM,
        // newlines included. A single-line value is accepted too: some secret stores collapse
        // them, and the PEM is unparseable without its line breaks.
        privateKey = createPrivateKey(restorePemNewlines(rawPrivateKey))
      } catch (error: any) {
        logger.error('SNOWFLAKE_PRIVATE_KEY is not a readable private key; Snowflake is disabled', {
          error: error?.message ?? 'unknown'
        })
      }
    }
  }

  if (!privateKey) {
    logger.info('Snowflake is not configured; any query will be refused')
  }

  let cachedJwt: { token: string; expiresAt: number } | undefined

  function currentJwt(key: KeyObject): string {
    const now = Date.now()
    if (cachedJwt && cachedJwt.expiresAt > now) {
      return cachedJwt.token
    }
    const issuedAt = Math.floor(now / 1000)
    const token = buildAccountJwt(key, account, user, issuedAt, 3600)
    cachedJwt = { token, expiresAt: now + JWT_TTL_MS }
    return token
  }

  /** Aborts a request the warehouse never answers, so a sync cannot hang a replica forever. */
  function withDeadline(init: FetchInit): { init: FetchInit; done: () => void } {
    const controller = new AbortController()
    const handle = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    return { init: { ...init, abortController: controller }, done: () => clearTimeout(handle) }
  }

  async function request(key: KeyObject, method: 'GET' | 'POST', path: string, payload?: unknown): Promise<ApiResult> {
    const { init, done } = withDeadline({
      method,
      headers: {
        Authorization: `Bearer ${currentJwt(key)}`,
        'X-Snowflake-Authorization-Token-Type': 'KEYPAIR_JWT',
        Accept: 'application/json',
        ...(payload === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) })
    })

    try {
      const response = await fetch.fetch(`https://${account}.snowflakecomputing.com${path}`, init)
      const body = (await response.json().catch(() => ({}))) as StatementResponse
      return { status: response.status, ok: response.ok, body }
    } finally {
      done()
    }
  }

  // The body names the real cause (an expired key, a role without USAGE on the warehouse, a
  // relation that does not exist); the status alone is almost always 400.
  function failure(what: string, result: ApiResult): Error {
    return new Error(`Snowflake ${what}: ${result.status} ${result.body?.message ?? ''}`.trim())
  }

  async function submit(key: KeyObject, statement: string): Promise<StatementResponse> {
    const result = await request(key, 'POST', `/api/v2/statements?requestId=${randomUUID()}`, {
      statement,
      timeout: STATEMENT_TIMEOUT_SECONDS,
      role: role || undefined,
      warehouse: warehouse || undefined,
      database: database || undefined,
      schema: schema || undefined
    })
    if (result.status === 202 && result.body.statementHandle) {
      return awaitStatement(key, result.body.statementHandle)
    }
    if (!result.ok) {
      throw failure('rejected the statement', result)
    }
    return result.body
  }

  // 202 means still running, not "no result set". Read as the latter, a slow warehouse was an
  // empty feed and a day with nothing queued, and nothing said so. The result is asked for
  // until it is there or the statement's own timeout has passed, whichever comes first.
  async function awaitStatement(key: KeyObject, handle: string): Promise<StatementResponse> {
    const deadline = Date.now() + STATEMENT_TIMEOUT_SECONDS * 1000
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS)
      const result = await request(key, 'GET', `/api/v2/statements/${handle}`)
      if (result.status === 202) {
        continue
      }
      if (!result.ok) {
        throw failure(`refused statement ${handle}`, result)
      }
      return result.body
    }
    throw new Error(`Snowflake statement ${handle} was still running after ${STATEMENT_TIMEOUT_SECONDS}s`)
  }

  async function partition(key: KeyObject, statementHandle: string, index: number): Promise<(string | null)[][]> {
    const result = await request(key, 'GET', `/api/v2/statements/${statementHandle}?partition=${index}`)
    if (!result.ok) {
      throw failure(`refused partition ${index}`, result)
    }
    return result.body.data ?? []
  }

  return {
    isConfigured(): boolean {
      return privateKey !== undefined
    },

    async query(statement: string): Promise<SnowflakeRow[]> {
      if (!privateKey) {
        throw new Error('Snowflake is not configured')
      }

      const first = await submit(privateKey, statement)
      const metadata = first.resultSetMetaData
      if (!metadata) {
        // A statement that returns no result set at all, which for this service means the
        // query was not the SELECT it was supposed to be.
        return []
      }

      const pages = [first.data ?? []]
      // Snowflake splits a large result and hands back only the first chunk inline. One page
      // is the normal case here; the loop is what keeps a grown feed from being silently cut.
      const partitionCount = metadata.partitionInfo?.length ?? 1
      if (partitionCount > 1 && first.statementHandle) {
        for (let index = 1; index < partitionCount; index++) {
          pages.push(await partition(privateKey, first.statementHandle, index))
        }
      }

      return mapRows(metadata, pages.flat())
    }
  }
}

/**
 * A PEM whose newlines were lost to a single-line secret store. The body is base64, so the
 * only thing needed is to put the breaks back around the armour and every 64 characters.
 */
export function restorePemNewlines(pem: string): string {
  const trimmed = pem.trim()
  if (trimmed.includes('\n')) {
    return trimmed
  }
  const match = trimmed.match(/^-----BEGIN ([A-Z ]+)-----(.*)-----END \1-----$/)
  if (!match) {
    return trimmed
  }
  const [, label, body] = match
  const wrapped = body.replace(/\s/g, '').replace(/(.{64})/g, '$1\n').trim()
  return `-----BEGIN ${label}-----\n${wrapped}\n-----END ${label}-----\n`
}
