// Apple App Attest verification.
//
// Entry points:
//   issueChallenge()      - mint a stateless HMAC-signed challenge. The
//     client passes it to App Attest, which embeds SHA256(challenge) in
//     the leaf cert's nonce extension. No DB row is created.
//   verifyChallenge()     - validate the HMAC and TTL, recover the original
//     challenge bytes (so verifyRegistration can recompute Apple's nonce).
//   verifyRegistration()  - run the App Attest "validating apps" ceremony
//     from Apple's docs and return the leaf public key (SPKI PEM). Used
//     once per session token issuance: the client generates a fresh key
//     (via DCAppAttestService.generateKey, ~200ms in Secure Enclave), so
//     no public key persistence is needed.
//
// Spec: https://developer.apple.com/documentation/devicecheck/validating-apps-that-connect-to-your-server
//
// Implementation note: node-forge's pki module can't parse EC public keys in
// X.509 certificates, so we use Node's built-in crypto.X509Certificate for
// chain verification and forge.asn1 only to walk the cert structure and pull
// the Apple-specific nonce extension out by OID.

import crypto from 'node:crypto'
import { decode as cborDecode } from 'cbor-x'
import forge from 'node-forge'

import { AppComponents } from '../types'
import { APPLE_APP_ATTEST_ROOT_CA_PEM } from './apple-root-ca'

const APPLE_NONCE_OID = '1.2.840.113635.100.8.2'

// Apple uses "appattestdevelop" for sandbox-attested keys and
// "appattest\0\0\0\0\0\0\0" for production. Both are 16 raw bytes long.
const AAGUID_DEV = Buffer.from('appattestdevelop', 'utf8')
const AAGUID_PROD = Buffer.concat([Buffer.from('appattest', 'utf8'), Buffer.alloc(7, 0)])

const APPLE_ROOT_X509 = new crypto.X509Certificate(APPLE_APP_ATTEST_ROOT_CA_PEM)

// Apple x5c chains observed in the wild are 2 certs (leaf + intermediate).
// Cap at 5 so a malicious client can't waste CPU shipping us a 1000-cert
// chain to verify before any other check kicks in.
const MAX_X5C_CHAIN_LENGTH = 5

// Stateless challenge format: nonce16 || expU64BE || mac16
// Total 40 bytes, base64url-encoded for transport (~54 chars).
// mac = HMAC-SHA256(secret, CHALLENGE_DOMAIN || nonce || expU64BE), truncated.
const CHALLENGE_NONCE_LEN = 16
const CHALLENGE_EXP_LEN = 8
const CHALLENGE_MAC_LEN = 16
const CHALLENGE_TOTAL_LEN = CHALLENGE_NONCE_LEN + CHALLENGE_EXP_LEN + CHALLENGE_MAC_LEN
// Domain separator: keeps the secret reusable for other purposes without
// the HMAC output of one context being a valid tag in another.
const CHALLENGE_DOMAIN = Buffer.from('v1:attest-challenge', 'utf8')
const CHALLENGE_TTL_MS = 5 * 60 * 1000
const MIN_SECRET_LENGTH = 32

// Granular error codes — surfaced to the client through the
// attestation-verifier outcome so the client (and analytics) can branch on
// the failure mode without parsing free-form messages.
export type AppAttestErrorCode = 'ATTESTATION_IOS_BAD_CBOR' | 'ATTESTATION_IOS_BAD_ASSERTION'

export class AppAttestError extends Error {
  code: AppAttestErrorCode
  constructor(code: AppAttestErrorCode, message: string) {
    super(message)
    this.name = 'AppAttestError'
    this.code = code
  }
}

export type AppAttestEnv = 'development' | 'production'

export type IAppAttestComponent = {
  issueChallenge(): { challenge: string; expiresAt: string }
  verifyChallenge(challenge: string): Buffer | null
  verifyRegistration(input: {
    keyIdB64u: string
    attestationObjectB64u: string
    challengeBytes: Buffer
  }): { publicKeyPem: string }
}

export async function createAppAttestComponent({
  config
}: Pick<AppComponents, 'config'>): Promise<IAppAttestComponent> {
  const expectedAppId = await config.requireString('APP_ATTEST_APP_ID')
  // `.env.default` ships these vars as empty strings (so they appear as
  // documentation placeholders) — `config.getString` returns `''` rather
  // than `undefined` in that case, which ?? would not catch. Coerce empties
  // to undefined before applying the ENV-derived fallback.
  const appAttestEnvRaw = (await config.getString('APP_ATTEST_ENV')) || undefined
  const deployEnv = (await config.getString('ENV')) || undefined
  const envRaw = appAttestEnvRaw ?? (deployEnv === 'prd' ? 'production' : 'development')
  if (envRaw !== 'development' && envRaw !== 'production') {
    throw new Error(`APP_ATTEST_ENV must be 'development' or 'production', got '${envRaw}'`)
  }
  const env: AppAttestEnv = envRaw

  // Reuses ATTESTATION_SESSION_SECRET (the same key that signs session
  // tokens). Safe because of CHALLENGE_DOMAIN — the HMAC inputs are
  // disjoint, so a challenge tag is never a valid session-token tag.
  const secret = await config.requireString('ATTESTATION_SESSION_SECRET')
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `ATTESTATION_SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} chars (use a 256-bit random secret)`
    )
  }

  function macChallenge(nonce: Buffer, expBuf: Buffer): Buffer {
    return crypto
      .createHmac('sha256', secret)
      .update(CHALLENGE_DOMAIN)
      .update(nonce)
      .update(expBuf)
      .digest()
      .subarray(0, CHALLENGE_MAC_LEN)
  }

  function issueChallenge(): { challenge: string; expiresAt: string } {
    const nonce = crypto.randomBytes(CHALLENGE_NONCE_LEN)
    const expMs = Date.now() + CHALLENGE_TTL_MS
    const expBuf = Buffer.alloc(CHALLENGE_EXP_LEN)
    expBuf.writeBigUInt64BE(BigInt(expMs), 0)
    const mac = macChallenge(nonce, expBuf)
    const challengeBytes = Buffer.concat([nonce, expBuf, mac])
    return {
      challenge: challengeBytes.toString('base64url'),
      expiresAt: new Date(expMs).toISOString()
    }
  }

  function verifyChallenge(challenge: string): Buffer | null {
    if (typeof challenge !== 'string' || challenge.length === 0) return null
    const bytes = Buffer.from(challenge, 'base64url')
    // Buffer.from(..., 'base64url') silently truncates on bad input, so a
    // length check is both a format gate and an integrity guard.
    if (bytes.length !== CHALLENGE_TOTAL_LEN) return null
    const nonce = bytes.subarray(0, CHALLENGE_NONCE_LEN)
    const expBuf = bytes.subarray(CHALLENGE_NONCE_LEN, CHALLENGE_NONCE_LEN + CHALLENGE_EXP_LEN)
    const mac = bytes.subarray(CHALLENGE_NONCE_LEN + CHALLENGE_EXP_LEN)
    const expectedMac = macChallenge(nonce, expBuf)
    if (mac.length !== expectedMac.length || !crypto.timingSafeEqual(mac, expectedMac)) return null
    const expMs = Number(expBuf.readBigUInt64BE(0))
    if (!Number.isFinite(expMs) || expMs < Date.now()) return null
    return bytes
  }

  function verifyRegistration({
    keyIdB64u,
    attestationObjectB64u,
    challengeBytes
  }: {
    keyIdB64u: string
    attestationObjectB64u: string
    challengeBytes: Buffer
  }): { publicKeyPem: string } {
    const attObjBytes = Buffer.from(attestationObjectB64u, 'base64url')
    let decoded: any
    try {
      decoded = cborDecode(attObjBytes)
    } catch (e: any) {
      throw new AppAttestError('ATTESTATION_IOS_BAD_CBOR', `attestation_object is not valid CBOR: ${e.message}`)
    }

    if (!decoded || decoded.fmt !== 'apple-appattest') {
      throw new AppAttestError('ATTESTATION_IOS_BAD_ASSERTION', `unexpected fmt: ${decoded && decoded.fmt}`)
    }

    const attStmt = decoded.attStmt
    const authData = bufferOf(decoded.authData, 'authData')
    const x5c = attStmt && attStmt.x5c
    if (!Array.isArray(x5c) || x5c.length === 0) {
      throw new AppAttestError('ATTESTATION_IOS_BAD_ASSERTION', 'attStmt.x5c missing or empty')
    }
    if (x5c.length > MAX_X5C_CHAIN_LENGTH) {
      throw new AppAttestError(
        'ATTESTATION_IOS_BAD_ASSERTION',
        `attStmt.x5c too long (${x5c.length} > ${MAX_X5C_CHAIN_LENGTH})`
      )
    }

    // Chain verification: each cert is signed by the next, last one chains up
    // to Apple's root CA.
    const certs = x5c.map((der: Uint8Array) => new crypto.X509Certificate(Buffer.from(der)))
    verifyCertChain(certs, APPLE_ROOT_X509)

    const leafCert = certs[0]
    const leafDer = Buffer.from(x5c[0])

    const challengeHash = sha256(challengeBytes)
    const expectedNonce = sha256(Buffer.concat([authData, challengeHash]))
    const certNonce = extractAppleNonce(leafDer)
    if (!certNonce.equals(expectedNonce)) {
      throw new AppAttestError(
        'ATTESTATION_IOS_BAD_ASSERTION',
        'Apple nonce extension does not match SHA256(authData || SHA256(challenge))'
      )
    }

    const keyIdBytes = Buffer.from(keyIdB64u, 'base64url')
    const jwk = leafCert.publicKey.export({ format: 'jwk' }) as { kty?: string; crv?: string; x?: string; y?: string }
    if (jwk.kty !== 'EC' || jwk.crv !== 'P-256') {
      throw new AppAttestError('ATTESTATION_IOS_BAD_ASSERTION', `expected EC P-256 leaf key, got ${jwk.kty}/${jwk.crv}`)
    }
    const xBytes = Buffer.from(jwk.x!, 'base64url')
    const yBytes = Buffer.from(jwk.y!, 'base64url')
    if (xBytes.length !== 32 || yBytes.length !== 32) {
      throw new AppAttestError('ATTESTATION_IOS_BAD_ASSERTION', 'leaf EC public key components not 32 bytes')
    }
    const uncompressedPoint = Buffer.concat([Buffer.from([0x04]), xBytes, yBytes])
    const publicKeyHash = sha256(uncompressedPoint)
    if (!publicKeyHash.equals(keyIdBytes)) {
      throw new AppAttestError(
        'ATTESTATION_IOS_BAD_ASSERTION',
        'SHA256(leaf public key) does not equal the provided key_id'
      )
    }

    const parsed = parseAuthData(authData, { expectAttestedCredential: true })
    if (!parsed.credentialId || !parsed.credentialId.equals(keyIdBytes)) {
      throw new AppAttestError(
        'ATTESTATION_IOS_BAD_ASSERTION',
        'authData credentialId does not equal the provided key_id'
      )
    }

    const expectedAaguid = env === 'production' ? AAGUID_PROD : AAGUID_DEV
    if (!parsed.aaguid!.equals(expectedAaguid)) {
      throw new AppAttestError(
        'ATTESTATION_IOS_BAD_ASSERTION',
        `aaguid mismatch for APP_ATTEST_ENV=${env} (got 0x${parsed.aaguid!.toString('hex')})`
      )
    }

    const expectedRpIdHash = sha256(Buffer.from(expectedAppId, 'utf8'))
    if (!parsed.rpIdHash.equals(expectedRpIdHash)) {
      throw new AppAttestError('ATTESTATION_IOS_BAD_ASSERTION', 'authData RP ID hash does not match appId')
    }

    const publicKeyPem = leafCert.publicKey.export({ format: 'pem', type: 'spki' }) as string
    return { publicKeyPem }
  }

  return { issueChallenge, verifyChallenge, verifyRegistration }
}

function sha256(buf: Buffer): Buffer {
  return crypto.createHash('sha256').update(buf).digest()
}

function bufferOf(val: unknown, label: string): Buffer {
  if (Buffer.isBuffer(val)) return val
  if (val instanceof Uint8Array) return Buffer.from(val)
  throw new AppAttestError('ATTESTATION_IOS_BAD_ASSERTION', `${label} missing or not bytes`)
}

function verifyCertChain(chain: crypto.X509Certificate[], root: crypto.X509Certificate): void {
  for (let i = 0; i < chain.length - 1; i++) {
    const child = chain[i]
    const issuer = chain[i + 1]
    if (!child.checkIssued(issuer) || !child.verify(issuer.publicKey)) {
      throw new AppAttestError(
        'ATTESTATION_IOS_BAD_ASSERTION',
        `cert chain broken at index ${i} (issuer mismatch or bad signature)`
      )
    }
  }
  const last = chain[chain.length - 1]
  if (!last.checkIssued(root) || !last.verify(root.publicKey)) {
    throw new AppAttestError(
      'ATTESTATION_IOS_BAD_ASSERTION',
      'last cert in x5c is not signed by Apple App Attest Root CA'
    )
  }
  const now = new Date()
  for (const cert of chain) {
    if (new Date(cert.validFrom) > now || new Date(cert.validTo) < now) {
      throw new AppAttestError('ATTESTATION_IOS_BAD_ASSERTION', `cert outside validity window: ${cert.subject}`)
    }
  }
}

function parseAuthData(
  buf: Buffer,
  { expectAttestedCredential }: { expectAttestedCredential: boolean }
): { rpIdHash: Buffer; flags: number; counter: number; aaguid: Buffer | null; credentialId: Buffer | null } {
  if (buf.length < 37) throw new AppAttestError('ATTESTATION_IOS_BAD_ASSERTION', 'authData too short')
  const rpIdHash = buf.subarray(0, 32)
  const flags = buf[32]
  const counter = buf.readUInt32BE(33)
  let aaguid: Buffer | null = null
  let credentialId: Buffer | null = null
  if (expectAttestedCredential) {
    if (buf.length < 55) {
      throw new AppAttestError('ATTESTATION_IOS_BAD_ASSERTION', 'authData missing attested credential data')
    }
    aaguid = buf.subarray(37, 53)
    const credLen = buf.readUInt16BE(53)
    if (buf.length < 55 + credLen) {
      throw new AppAttestError('ATTESTATION_IOS_BAD_ASSERTION', 'authData truncated credentialId')
    }
    credentialId = buf.subarray(55, 55 + credLen)
  }
  return { rpIdHash, flags, counter, aaguid, credentialId }
}

function extractAppleNonce(certDer: Buffer): Buffer {
  // Walk the X.509 ASN.1 tree to find the [3]-tagged Extensions block of
  // TBSCertificate, then locate the extension whose OID matches Apple's
  // nonce OID. The extension's OCTET STRING contains a SEQUENCE with one
  // [1]-tagged OCTET STRING — the nonce itself.
  let asn1: any
  try {
    asn1 = forge.asn1.fromDer(forge.util.createBuffer(certDer))
  } catch (e: any) {
    throw new AppAttestError('ATTESTATION_IOS_BAD_ASSERTION', `leaf cert ASN.1 parse failed: ${e.message}`)
  }

  const tbsCert = asn1 && asn1.value && asn1.value[0]
  if (!tbsCert || !Array.isArray(tbsCert.value)) {
    throw new AppAttestError('ATTESTATION_IOS_BAD_ASSERTION', 'leaf cert has no TBSCertificate')
  }

  const extensionsBlock = tbsCert.value.find(
    (n: any) => n.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && n.type === 3
  )
  if (!extensionsBlock) {
    throw new AppAttestError('ATTESTATION_IOS_BAD_ASSERTION', 'leaf cert has no extensions block')
  }
  const extensionsSeq = extensionsBlock.value && extensionsBlock.value[0]
  if (!extensionsSeq || !Array.isArray(extensionsSeq.value)) {
    throw new AppAttestError('ATTESTATION_IOS_BAD_ASSERTION', 'leaf cert extensions block malformed')
  }

  for (const ext of extensionsSeq.value) {
    if (!Array.isArray(ext.value) || ext.value.length < 2) continue
    const oidAsn1 = ext.value[0]
    const oidStr = forge.asn1.derToOid(oidAsn1.value)
    if (oidStr !== APPLE_NONCE_OID) continue
    const octetString = ext.value[ext.value.length - 1]
    const innerBytes = octetString.value
    const inner = forge.asn1.fromDer(innerBytes)
    // SEQUENCE { [1] EXPLICIT OCTET STRING nonce }
    const tagged: any = inner && (inner as any).value && (inner as any).value[0]
    const nonceOctet: any = tagged && tagged.value && tagged.value[0]
    if (!nonceOctet || typeof nonceOctet.value !== 'string') {
      throw new AppAttestError('ATTESTATION_IOS_BAD_ASSERTION', 'nonce extension has unexpected ASN.1 shape')
    }
    return Buffer.from(nonceOctet.value, 'binary')
  }

  throw new AppAttestError(
    'ATTESTATION_IOS_BAD_ASSERTION',
    `leaf certificate is missing extension ${APPLE_NONCE_OID}`
  )
}
