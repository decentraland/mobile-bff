// Apple App Attest verification.
//
// Two entry points:
//   verifyRegistration() - runs the seven-step "validating apps" ceremony
//     from Apple's docs, returns the leaf public key (SPKI PEM) so the
//     caller can persist it alongside the client-supplied key_id.
//   verifyAssertion()    - verifies a per-request CBOR assertion against
//     the previously persisted public key, the raw request body, and a
//     monotonic counter.
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

export class AppAttestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AppAttestError'
  }
}

export type AppAttestEnv = 'development' | 'production'

export type IAppAttestComponent = {
  verifyRegistration(input: {
    keyIdB64u: string
    attestationObjectB64u: string
    challengeBytes: Buffer
  }): { publicKeyPem: string }
  verifyAssertion(input: {
    assertionB64u: string
    nonceBytes: Buffer
    rawBody: Buffer
    storedPublicKeyPem: string
    storedCounter: number
  }): { newCounter: number }
}

export async function createAppAttestComponent({
  config
}: Pick<AppComponents, 'config'>): Promise<IAppAttestComponent> {
  const expectedAppId = await config.requireString('APP_ATTEST_APP_ID')
  const envRaw = (await config.getString('APP_ATTEST_ENV')) ?? 'development'
  if (envRaw !== 'development' && envRaw !== 'production') {
    throw new Error(`APP_ATTEST_ENV must be 'development' or 'production', got '${envRaw}'`)
  }
  const env: AppAttestEnv = envRaw

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
      throw new AppAttestError(`attestation_object is not valid CBOR: ${e.message}`)
    }

    if (!decoded || decoded.fmt !== 'apple-appattest') {
      throw new AppAttestError(`unexpected fmt: ${decoded && decoded.fmt}`)
    }

    const attStmt = decoded.attStmt
    const authData = bufferOf(decoded.authData, 'authData')
    const x5c = attStmt && attStmt.x5c
    if (!Array.isArray(x5c) || x5c.length === 0) {
      throw new AppAttestError('attStmt.x5c missing or empty')
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
      throw new AppAttestError('Apple nonce extension does not match SHA256(authData || SHA256(challenge))')
    }

    const keyIdBytes = Buffer.from(keyIdB64u, 'base64url')
    const jwk = leafCert.publicKey.export({ format: 'jwk' }) as { kty?: string; crv?: string; x?: string; y?: string }
    if (jwk.kty !== 'EC' || jwk.crv !== 'P-256') {
      throw new AppAttestError(`expected EC P-256 leaf key, got ${jwk.kty}/${jwk.crv}`)
    }
    const xBytes = Buffer.from(jwk.x!, 'base64url')
    const yBytes = Buffer.from(jwk.y!, 'base64url')
    if (xBytes.length !== 32 || yBytes.length !== 32) {
      throw new AppAttestError('leaf EC public key components not 32 bytes')
    }
    const uncompressedPoint = Buffer.concat([Buffer.from([0x04]), xBytes, yBytes])
    const publicKeyHash = sha256(uncompressedPoint)
    if (!publicKeyHash.equals(keyIdBytes)) {
      throw new AppAttestError('SHA256(leaf public key) does not equal the provided key_id')
    }

    const parsed = parseAuthData(authData, { expectAttestedCredential: true })
    if (!parsed.credentialId || !parsed.credentialId.equals(keyIdBytes)) {
      throw new AppAttestError('authData credentialId does not equal the provided key_id')
    }

    const expectedAaguid = env === 'production' ? AAGUID_PROD : AAGUID_DEV
    if (!parsed.aaguid!.equals(expectedAaguid)) {
      throw new AppAttestError(
        `aaguid mismatch for APP_ATTEST_ENV=${env} (got 0x${parsed.aaguid!.toString('hex')})`
      )
    }

    const expectedRpIdHash = sha256(Buffer.from(expectedAppId, 'utf8'))
    if (!parsed.rpIdHash.equals(expectedRpIdHash)) {
      throw new AppAttestError('authData RP ID hash does not match appId')
    }

    const publicKeyPem = leafCert.publicKey.export({ format: 'pem', type: 'spki' }) as string
    return { publicKeyPem }
  }

  function verifyAssertion({
    assertionB64u,
    nonceBytes,
    rawBody,
    storedPublicKeyPem,
    storedCounter
  }: {
    assertionB64u: string
    nonceBytes: Buffer
    rawBody: Buffer
    storedPublicKeyPem: string
    storedCounter: number
  }): { newCounter: number } {
    const assertionBytes = Buffer.from(assertionB64u, 'base64url')
    let decoded: any
    try {
      decoded = cborDecode(assertionBytes)
    } catch (e: any) {
      throw new AppAttestError(`assertion is not valid CBOR: ${e.message}`)
    }

    const signature = bufferOf(decoded && decoded.signature, 'signature')
    const authData = bufferOf(decoded && decoded.authenticatorData, 'authenticatorData')
    if (authData.length < 37) {
      throw new AppAttestError('assertion authenticatorData too short')
    }

    // clientDataHash = SHA256(raw request body || client-supplied nonce)
    const clientDataHash = sha256(Buffer.concat([rawBody, nonceBytes]))

    // Apple App Attest's per-request signature is over `nonce` (where
    // `nonce = SHA256(authData || clientDataHash)`) passed AS A MESSAGE to
    // the ECDSA-SHA256 signer — so the signer hashes `nonce` again
    // internally, and the value that ECDSA actually signs is SHA256(nonce).
    // To verify we must mirror that: compute `nonce`, then `update(nonce)`
    // so Node also applies SHA256 inside createVerify("SHA256"). Feeding
    // `update(authData) + update(clientDataHash)` only hashes once and
    // verifies against the wrong digest.
    const nonce = sha256(Buffer.concat([authData, clientDataHash]))
    const verifier = crypto.createVerify('SHA256')
    verifier.update(nonce)
    const verified = verifier.verify(storedPublicKeyPem, signature)
    if (!verified) {
      throw new AppAttestError('assertion signature invalid')
    }

    const expectedRpIdHash = sha256(Buffer.from(expectedAppId, 'utf8'))
    if (!authData.subarray(0, 32).equals(expectedRpIdHash)) {
      throw new AppAttestError('assertion RP ID hash does not match appId')
    }

    const newCounter = authData.readUInt32BE(33)
    if (newCounter <= storedCounter) {
      throw new AppAttestError(`counter replay (stored=${storedCounter}, received=${newCounter})`)
    }

    return { newCounter }
  }

  return { verifyRegistration, verifyAssertion }
}

function sha256(buf: Buffer): Buffer {
  return crypto.createHash('sha256').update(buf).digest()
}

function bufferOf(val: unknown, label: string): Buffer {
  if (Buffer.isBuffer(val)) return val
  if (val instanceof Uint8Array) return Buffer.from(val)
  throw new AppAttestError(`${label} missing or not bytes`)
}

function verifyCertChain(chain: crypto.X509Certificate[], root: crypto.X509Certificate): void {
  for (let i = 0; i < chain.length - 1; i++) {
    const child = chain[i]
    const issuer = chain[i + 1]
    if (!child.checkIssued(issuer) || !child.verify(issuer.publicKey)) {
      throw new AppAttestError(`cert chain broken at index ${i} (issuer mismatch or bad signature)`)
    }
  }
  const last = chain[chain.length - 1]
  if (!last.checkIssued(root) || !last.verify(root.publicKey)) {
    throw new AppAttestError('last cert in x5c is not signed by Apple App Attest Root CA')
  }
  const now = new Date()
  for (const cert of chain) {
    if (new Date(cert.validFrom) > now || new Date(cert.validTo) < now) {
      throw new AppAttestError(`cert outside validity window: ${cert.subject}`)
    }
  }
}

function parseAuthData(
  buf: Buffer,
  { expectAttestedCredential }: { expectAttestedCredential: boolean }
): { rpIdHash: Buffer; flags: number; counter: number; aaguid: Buffer | null; credentialId: Buffer | null } {
  if (buf.length < 37) throw new AppAttestError('authData too short')
  const rpIdHash = buf.subarray(0, 32)
  const flags = buf[32]
  const counter = buf.readUInt32BE(33)
  let aaguid: Buffer | null = null
  let credentialId: Buffer | null = null
  if (expectAttestedCredential) {
    if (buf.length < 55) {
      throw new AppAttestError('authData missing attested credential data')
    }
    aaguid = buf.subarray(37, 53)
    const credLen = buf.readUInt16BE(53)
    if (buf.length < 55 + credLen) {
      throw new AppAttestError('authData truncated credentialId')
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
    asn1 = forge.asn1.fromDer(forge.util.createBuffer(certDer.toString('binary'), 'raw'))
  } catch (e: any) {
    throw new AppAttestError(`leaf cert ASN.1 parse failed: ${e.message}`)
  }

  const tbsCert = asn1 && asn1.value && asn1.value[0]
  if (!tbsCert || !Array.isArray(tbsCert.value)) {
    throw new AppAttestError('leaf cert has no TBSCertificate')
  }

  const extensionsBlock = tbsCert.value.find(
    (n: any) => n.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && n.type === 3
  )
  if (!extensionsBlock) {
    throw new AppAttestError('leaf cert has no extensions block')
  }
  const extensionsSeq = extensionsBlock.value && extensionsBlock.value[0]
  if (!extensionsSeq || !Array.isArray(extensionsSeq.value)) {
    throw new AppAttestError('leaf cert extensions block malformed')
  }

  for (const ext of extensionsSeq.value) {
    if (!Array.isArray(ext.value) || ext.value.length < 2) continue
    const oidAsn1 = ext.value[0]
    const oidStr = forge.asn1.derToOid(oidAsn1.value)
    if (oidStr !== APPLE_NONCE_OID) continue
    const octetString = ext.value[ext.value.length - 1]
    const innerBytes = octetString.value
    const inner = forge.asn1.fromDer(forge.util.createBuffer(innerBytes, 'raw'))
    // SEQUENCE { [1] EXPLICIT OCTET STRING nonce }
    const tagged: any = inner && (inner as any).value && (inner as any).value[0]
    const nonceOctet: any = tagged && tagged.value && tagged.value[0]
    if (!nonceOctet || typeof nonceOctet.value !== 'string') {
      throw new AppAttestError('nonce extension has unexpected ASN.1 shape')
    }
    return Buffer.from(nonceOctet.value, 'binary')
  }

  throw new AppAttestError(`leaf certificate is missing extension ${APPLE_NONCE_OID}`)
}
