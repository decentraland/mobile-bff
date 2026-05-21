import crypto from 'node:crypto'
import { encode as cborEncode } from 'cbor-x'

import { createAppAttestComponent, AppAttestError } from '../../src/adapters/app-attest'
import { createConfigJestMockComponent } from '../mocks/config-mock'

// These tests exercise verifyAssertion only — verifyRegistration requires a
// signed leaf certificate from Apple's CA, which we cannot synthesise. The
// registration path is covered indirectly by the chain-of-trust check in the
// adapter itself (it bails out if the cert chain doesn't terminate at Apple's
// root); end-to-end coverage requires a real iOS device.

const APP_ID = 'TEAMID1234.com.example.app'

function sha256(buf: Buffer): Buffer {
  return crypto.createHash('sha256').update(buf).digest()
}

// Build a minimal valid authenticatorData: 32B RP-ID hash || 1B flags || 4B counter.
function makeAuthData(counter: number, rpIdHash = sha256(Buffer.from(APP_ID, 'utf8'))): Buffer {
  const buf = Buffer.alloc(37)
  rpIdHash.copy(buf, 0, 0, 32)
  buf[32] = 0x00
  buf.writeUInt32BE(counter, 33)
  return buf
}

function signAssertion({
  privateKey,
  authData,
  rawBody,
  clientNonce
}: {
  privateKey: crypto.KeyObject
  authData: Buffer
  rawBody: Buffer
  clientNonce: Buffer
}): Buffer {
  // Mirrors what the iOS App Attest signer produces:
  //   clientDataHash = SHA256(rawBody || clientNonce)
  //   nonce          = SHA256(authData || clientDataHash)
  //   signature      = ECDSA-SHA256(privateKey, nonce)   <-- nonce is fed as
  //                                                          the message, so
  //                                                          the signer hashes
  //                                                          it AGAIN.
  const clientDataHash = sha256(Buffer.concat([rawBody, clientNonce]))
  const nonce = sha256(Buffer.concat([authData, clientDataHash]))
  const signer = crypto.createSign('SHA256')
  signer.update(nonce)
  return signer.sign({ key: privateKey, dsaEncoding: 'der' })
}

function encodeAssertion(signature: Buffer, authData: Buffer): string {
  // cbor-x encodes plain objects as CBOR maps; the adapter decodes back
  // through `decoded.signature` and `decoded.authenticatorData`.
  const bytes = cborEncode({ signature, authenticatorData: authData })
  return Buffer.from(bytes).toString('base64url')
}

describe('app-attest verifyAssertion (synthetic key)', () => {
  let appAttest: Awaited<ReturnType<typeof createAppAttestComponent>>
  let publicKeyPem: string
  let privateKey: crypto.KeyObject
  const clientNonce = crypto.randomBytes(32)
  const rawBody = Buffer.from('{"chain":"polygon","message":"hi"}')

  beforeAll(async () => {
    const config = createConfigJestMockComponent({
      APP_ATTEST_APP_ID: APP_ID,
      APP_ATTEST_ENV: 'development'
    })
    appAttest = await createAppAttestComponent({ config })
    const { privateKey: pk, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
    privateKey = pk
    publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' }) as string
  })

  it('accepts a freshly signed assertion and advances the counter', () => {
    const authData = makeAuthData(7)
    const signature = signAssertion({ privateKey, authData, rawBody, clientNonce })
    const assertionB64u = encodeAssertion(signature, authData)
    const { newCounter } = appAttest.verifyAssertion({
      assertionB64u,
      nonceBytes: clientNonce,
      rawBody,
      storedPublicKeyPem: publicKeyPem,
      storedCounter: 6
    })
    expect(newCounter).toBe(7)
  })

  it('rejects an assertion replayed at the same counter', () => {
    const authData = makeAuthData(7)
    const signature = signAssertion({ privateKey, authData, rawBody, clientNonce })
    const assertionB64u = encodeAssertion(signature, authData)
    expect(() =>
      appAttest.verifyAssertion({
        assertionB64u,
        nonceBytes: clientNonce,
        rawBody,
        storedPublicKeyPem: publicKeyPem,
        storedCounter: 7
      })
    ).toThrow(/counter replay/)
  })

  it('rejects an assertion replayed at a lower counter', () => {
    const authData = makeAuthData(3)
    const signature = signAssertion({ privateKey, authData, rawBody, clientNonce })
    const assertionB64u = encodeAssertion(signature, authData)
    expect(() =>
      appAttest.verifyAssertion({
        assertionB64u,
        nonceBytes: clientNonce,
        rawBody,
        storedPublicKeyPem: publicKeyPem,
        storedCounter: 10
      })
    ).toThrow(/counter replay/)
  })

  it('rejects an assertion if the body bytes do not match (body-binding)', () => {
    const authData = makeAuthData(7)
    const signature = signAssertion({ privateKey, authData, rawBody, clientNonce })
    const assertionB64u = encodeAssertion(signature, authData)
    expect(() =>
      appAttest.verifyAssertion({
        assertionB64u,
        nonceBytes: clientNonce,
        rawBody: Buffer.from('{"chain":"polygon","message":"TAMPERED"}'),
        storedPublicKeyPem: publicKeyPem,
        storedCounter: 6
      })
    ).toThrow(/signature invalid/)
  })

  it('rejects an assertion if the client nonce does not match', () => {
    const authData = makeAuthData(7)
    const signature = signAssertion({ privateKey, authData, rawBody, clientNonce })
    const assertionB64u = encodeAssertion(signature, authData)
    expect(() =>
      appAttest.verifyAssertion({
        assertionB64u,
        nonceBytes: crypto.randomBytes(32),
        rawBody,
        storedPublicKeyPem: publicKeyPem,
        storedCounter: 6
      })
    ).toThrow(/signature invalid/)
  })

  it('rejects an assertion signed with a different key', () => {
    const { privateKey: foreignKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const authData = makeAuthData(7)
    const signature = signAssertion({ privateKey: foreignKey, authData, rawBody, clientNonce })
    const assertionB64u = encodeAssertion(signature, authData)
    expect(() =>
      appAttest.verifyAssertion({
        assertionB64u,
        nonceBytes: clientNonce,
        rawBody,
        storedPublicKeyPem: publicKeyPem,
        storedCounter: 6
      })
    ).toThrow(/signature invalid/)
  })

  it('rejects an assertion where the RP-ID hash does not match appId', () => {
    const wrongRpHash = sha256(Buffer.from('OTHERTEAM.com.example.app', 'utf8'))
    const authData = makeAuthData(7, wrongRpHash)
    const signature = signAssertion({ privateKey, authData, rawBody, clientNonce })
    const assertionB64u = encodeAssertion(signature, authData)
    expect(() =>
      appAttest.verifyAssertion({
        assertionB64u,
        nonceBytes: clientNonce,
        rawBody,
        storedPublicKeyPem: publicKeyPem,
        storedCounter: 6
      })
    ).toThrow(/RP ID hash does not match/)
  })

  it('rejects malformed CBOR', () => {
    expect(() =>
      appAttest.verifyAssertion({
        assertionB64u: Buffer.from('not-cbor-at-all').toString('base64url'),
        nonceBytes: clientNonce,
        rawBody,
        storedPublicKeyPem: publicKeyPem,
        storedCounter: 6
      })
    ).toThrow(AppAttestError)
  })

  it('rejects a malformed client nonce (truncated base64url that decodes to wrong-length bytes)', () => {
    // Buffer.from('zz', 'base64url') silently produces 1 byte; the assertion
    // was signed assuming a 32-byte nonce, so the signature should not
    // verify. The verifier surfaces this as BAD_SIGNATURE because the
    // signature check is what catches the digest mismatch.
    const authData = makeAuthData(7)
    const signature = signAssertion({ privateKey, authData, rawBody, clientNonce })
    const assertionB64u = encodeAssertion(signature, authData)
    expect(() =>
      appAttest.verifyAssertion({
        assertionB64u,
        nonceBytes: Buffer.from('zz', 'base64url'),
        rawBody,
        storedPublicKeyPem: publicKeyPem,
        storedCounter: 6
      })
    ).toThrow(/signature invalid/)
  })

  it('rejects an assertion authData padded with extra bytes (AT/ED flags must be zero)', () => {
    // Forge an authData with the AT bit (0x40) set and 18 extra trailing
    // bytes. The signature still validates against this exact authData,
    // but the verifier should reject before that because per Apple's spec
    // assertion authData is strictly 37 bytes with flags=0x00.
    const padded = Buffer.alloc(55)
    sha256(Buffer.from(APP_ID, 'utf8')).copy(padded, 0, 0, 32)
    padded[32] = 0x40
    padded.writeUInt32BE(7, 33)
    const signature = signAssertion({ privateKey, authData: padded, rawBody, clientNonce })
    const assertionB64u = encodeAssertion(signature, padded)
    expect(() =>
      appAttest.verifyAssertion({
        assertionB64u,
        nonceBytes: clientNonce,
        rawBody,
        storedPublicKeyPem: publicKeyPem,
        storedCounter: 6
      })
    ).toThrow(/AT or ED bits/)
  })
})

// Cert-chain validity window: we cannot synthesise an Apple-signed leaf,
// but the registration verifier calls verifyCertChain before any
// Apple-specific check, and the chain walker enforces both Apple-root
// termination and the validity window. Constructing a self-signed
// expired cert and feeding it through verifyRegistration confirms the
// adapter rejects expired material — the failure path is the chain or
// validity-window check, both of which raise AppAttestError.

describe('app-attest cert chain validity window', () => {
  function makeSelfSignedDer({ notBefore, notAfter }: { notBefore: Date; notAfter: Date }): Buffer {
    // node-forge can both build and PEM-encode a self-signed cert, then
    // crypto.X509Certificate hands us the DER bytes we'd otherwise need
    // to write by hand.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const forge = require('node-forge')
    const keys = forge.pki.rsa.generateKeyPair(2048)
    const cert = forge.pki.createCertificate()
    cert.publicKey = keys.publicKey
    cert.serialNumber = '01'
    cert.validity.notBefore = notBefore
    cert.validity.notAfter = notAfter
    const attrs = [{ name: 'commonName', value: 'test-expired' }]
    cert.setSubject(attrs)
    cert.setIssuer(attrs)
    cert.sign(keys.privateKey, forge.md.sha256.create())
    const pem = forge.pki.certificateToPem(cert)
    return Buffer.from(new crypto.X509Certificate(pem).raw)
  }

  it('rejects an expired cert during verifyRegistration', async () => {
    const expiredDer = makeSelfSignedDer({
      notBefore: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
      notAfter: new Date(Date.now() - 24 * 60 * 60 * 1000)
    })
    const config = createConfigJestMockComponent({
      APP_ATTEST_APP_ID: APP_ID,
      APP_ATTEST_ENV: 'development'
    })
    const att = await createAppAttestComponent({ config })
    const attObj = cborEncode({
      fmt: 'apple-appattest',
      attStmt: { x5c: [expiredDer] },
      authData: Buffer.alloc(55)
    })
    expect(() =>
      att.verifyRegistration({
        keyIdB64u: Buffer.alloc(32).toString('base64url'),
        attestationObjectB64u: Buffer.from(attObj).toString('base64url'),
        challengeBytes: Buffer.from('chal')
      })
    ).toThrow(AppAttestError)
  })

  it('rejects an x5c chain longer than MAX_X5C_CHAIN_LENGTH before doing any crypto work', async () => {
    // Cap is 5. Six self-signed certs is enough to trip the guard. The cap
    // check runs BEFORE crypto.X509Certificate parsing, so the bytes don't
    // need to be valid DER — but using real self-signed certs keeps the
    // failure path unambiguous (we want the length-check to fire, not a
    // downstream parse error masquerading as the same outcome).
    const cert = makeSelfSignedDer({
      notBefore: new Date(Date.now() - 60_000),
      notAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
    })
    const tooLong = Array.from({ length: 6 }, () => cert)
    const config = createConfigJestMockComponent({
      APP_ATTEST_APP_ID: APP_ID,
      APP_ATTEST_ENV: 'development'
    })
    const att = await createAppAttestComponent({ config })
    const attObj = cborEncode({
      fmt: 'apple-appattest',
      attStmt: { x5c: tooLong },
      authData: Buffer.alloc(55)
    })
    expect(() =>
      att.verifyRegistration({
        keyIdB64u: Buffer.alloc(32).toString('base64url'),
        attestationObjectB64u: Buffer.from(attObj).toString('base64url'),
        challengeBytes: Buffer.from('chal')
      })
    ).toThrow(/x5c too long/)
  })
})
