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

  async function post(key: KeyObject, statement: string): Promise<StatementResponse> {
    const { init, done } = withDeadline({
      method: 'POST',
      headers: {
        Authorization: `Bearer ${currentJwt(key)}`,
        'X-Snowflake-Authorization-Token-Type': 'KEYPAIR_JWT',
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        statement,
        timeout: STATEMENT_TIMEOUT_SECONDS,
        role: role || undefined,
        warehouse: warehouse || undefined,
        database: database || undefined,
        schema: schema || undefined
      })
    })

    let body: StatementResponse
    let response: Awaited<ReturnType<IFetchComponent['fetch']>>
    try {
      response = await fetch.fetch(
        `https://${account}.snowflakecomputing.com/api/v2/statements?requestId=${randomUUID()}`,
        init
      )
      body = (await response.json().catch(() => ({}))) as StatementResponse
    } finally {
      done()
    }

    if (!response.ok) {
      // The body names the real cause (an expired key, a role without USAGE on the warehouse,
      // a relation that does not exist); the status alone is almost always 400.
      throw new Error(`Snowflake rejected the statement: ${response.status} ${body?.message ?? ''}`.trim())
    }
    return body
  }

  async function partition(key: KeyObject, statementHandle: string, index: number): Promise<(string | null)[][]> {
    const { init, done } = withDeadline({
      method: 'GET',
      headers: {
        Authorization: `Bearer ${currentJwt(key)}`,
        'X-Snowflake-Authorization-Token-Type': 'KEYPAIR_JWT',
        Accept: 'application/json'
      }
    })

    let body: StatementResponse
    let response: Awaited<ReturnType<IFetchComponent['fetch']>>
    try {
      response = await fetch.fetch(
        `https://${account}.snowflakecomputing.com/api/v2/statements/${statementHandle}?partition=${index}`,
        init
      )
      body = (await response.json().catch(() => ({}))) as StatementResponse
    } finally {
      done()
    }

    if (!response.ok) {
      throw new Error(`Snowflake refused partition ${index}: ${response.status} ${body?.message ?? ''}`.trim())
    }
    return body.data ?? []
  }

  return {
    isConfigured(): boolean {
      return privateKey !== undefined
    },

    async query(statement: string): Promise<SnowflakeRow[]> {
      if (!privateKey) {
        throw new Error('Snowflake is not configured')
      }

      const first = await post(privateKey, statement)
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
