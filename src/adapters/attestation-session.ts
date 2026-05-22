// Session tokens issued by POST /attest/session after a successful platform
// attestation. The token is replayed on subsequent /wallets/sign-message
// calls until it expires. One Play Integrity / App Attest verdict per
// session instead of per request.
//
// Token format: `<payloadB64u>.<tagB64u>`
//   payloadB64u = base64url(JSON.stringify({ v, platform, iat, exp, jti }))
//   tagB64u     = base64url(HMAC-SHA256(ATTESTATION_SESSION_SECRET, payloadB64u))
//
// We don't use full JWT (no header, no kid, no alg field on the wire)
// because there's only one signer (this server) and one algorithm (HMAC).
// Skipping the JOSE envelope avoids the alg-confusion class of bugs and
// keeps verification trivial.

import crypto from 'node:crypto'

import { AppComponents } from '../types'

const DEFAULT_TTL_MS = 48 * 60 * 60 * 1000 // 48 hours
const MIN_SECRET_LENGTH = 32

export type SessionTokenPayload = {
  v: 1
  platform: string
  iat: number
  exp: number
  jti: string
}

export type SessionIssueResult = {
  token: string
  expiresAt: number
}

export type SessionVerifyCode =
  | 'ATTESTATION_SESSION_MALFORMED'
  | 'ATTESTATION_SESSION_BAD_SIGNATURE'
  | 'ATTESTATION_SESSION_EXPIRED'
  | 'ATTESTATION_SESSION_BAD_VERSION'

// Flat-shape result rather than a discriminated union so callers can use
// dot access without strict-narrow gymnastics — the test tsconfig has
// strict mode off, which breaks `if (!ok)` narrowing on a true|false
// union. `payload` is defined on success; `code`/`error` on failure.
export type SessionVerifyResult = {
  ok: boolean
  payload?: SessionTokenPayload
  code?: SessionVerifyCode
  error?: string
}

export type IAttestationSessionComponent = {
  issue(input: { platform: string }): SessionIssueResult
  verify(token: string): SessionVerifyResult
}

export async function createAttestationSessionComponent({
  config
}: Pick<AppComponents, 'config'>): Promise<IAttestationSessionComponent> {
  const secret = await config.requireString('ATTESTATION_SESSION_SECRET')
  if (secret.length < MIN_SECRET_LENGTH) {
    // Hard fail at startup rather than serve with a weak HMAC key. The
    // recommended value is `openssl rand -base64 32`.
    throw new Error(
      `ATTESTATION_SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} chars (use a 256-bit random secret)`
    )
  }
  const ttlMsRaw = await config.getNumber('ATTESTATION_SESSION_TTL_MS')
  const ttlMs = ttlMsRaw && ttlMsRaw > 0 ? ttlMsRaw : DEFAULT_TTL_MS

  function sign(payloadB64u: string): string {
    return crypto.createHmac('sha256', secret).update(payloadB64u).digest('base64url')
  }

  function issue({ platform }: { platform: string }): SessionIssueResult {
    const now = Date.now()
    const expiresAt = now + ttlMs
    const payload: SessionTokenPayload = {
      v: 1,
      platform,
      iat: now,
      exp: expiresAt,
      jti: crypto.randomBytes(16).toString('base64url')
    }
    const payloadB64u = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
    const tag = sign(payloadB64u)
    return { token: `${payloadB64u}.${tag}`, expiresAt }
  }

  function verify(token: string): SessionVerifyResult {
    if (typeof token !== 'string' || token.length === 0) {
      return { ok: false, code: 'ATTESTATION_SESSION_MALFORMED', error: 'token is empty' }
    }
    const dotIdx = token.indexOf('.')
    if (dotIdx <= 0 || dotIdx === token.length - 1) {
      return { ok: false, code: 'ATTESTATION_SESSION_MALFORMED', error: 'token must be <payload>.<tag>' }
    }
    const payloadB64u = token.slice(0, dotIdx)
    const tag = token.slice(dotIdx + 1)

    const expectedTag = sign(payloadB64u)
    // timingSafeEqual requires equal-length buffers; if lengths differ, the
    // tag is wrong regardless and we short-circuit without leaking timing.
    const tagBuf = Buffer.from(tag, 'utf8')
    const expectedBuf = Buffer.from(expectedTag, 'utf8')
    if (tagBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(tagBuf, expectedBuf)) {
      return { ok: false, code: 'ATTESTATION_SESSION_BAD_SIGNATURE', error: 'tag does not match' }
    }

    let payload: SessionTokenPayload
    try {
      payload = JSON.parse(Buffer.from(payloadB64u, 'base64url').toString('utf8'))
    } catch (e: any) {
      return {
        ok: false,
        code: 'ATTESTATION_SESSION_MALFORMED',
        error: `payload is not valid JSON: ${e?.message || e}`
      }
    }
    if (payload.v !== 1) {
      return {
        ok: false,
        code: 'ATTESTATION_SESSION_BAD_VERSION',
        error: `unsupported token version ${payload.v}`
      }
    }
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) {
      return { ok: false, code: 'ATTESTATION_SESSION_EXPIRED', error: 'token expired' }
    }
    return { ok: true, payload }
  }

  return { issue, verify }
}
