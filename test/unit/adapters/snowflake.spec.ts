import { createHash, createPublicKey, generateKeyPairSync, verify } from 'node:crypto'
import {
  buildAccountJwt,
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
