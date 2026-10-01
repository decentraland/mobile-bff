import { generateKeyPairSync, verify } from 'node:crypto'
import { buildPayload, buildProviderToken, classifyApnsResponse } from '../../../src/adapters/apns'

// Same reasoning as the FCM classifier tests: the transport itself is one HTTP/2 request, and
// what is worth pinning down is the decision it feeds the dispatcher — retry, give up, or
// strike the token off every future audience.
describe('apns classifyApnsResponse', () => {
  it('strikes off tokens that will never work again', () => {
    // The app was uninstalled, or the token belongs to another app's topic.
    expect(classifyApnsResponse(410, 'Unregistered')).toEqual({
      errorCode: 'Unregistered',
      retryable: false,
      tokenIsDead: true
    })
    expect(classifyApnsResponse(400, 'BadDeviceToken')).toMatchObject({ retryable: false, tokenIsDead: true })
  })

  it('retries what is worth retrying and nothing else', () => {
    expect(classifyApnsResponse(429, 'TooManyRequests')).toMatchObject({ retryable: true, tokenIsDead: false })
    expect(classifyApnsResponse(503, 'ServiceUnavailable')).toMatchObject({ retryable: true, tokenIsDead: false })

    // Our own provider token went stale: the next attempt mints a fresh one, so the
    // delivery must stay in the queue rather than be written off.
    expect(classifyApnsResponse(403, 'ExpiredProviderToken')).toMatchObject({ retryable: true, tokenIsDead: false })

    // A malformed request of ours fails identically on retry; burning attempts on it only
    // delays the rest of the campaign.
    expect(classifyApnsResponse(400, 'BadTopic')).toMatchObject({ retryable: false, tokenIsDead: false })
  })

  it('still decides something useful when Apple names no reason', () => {
    expect(classifyApnsResponse(500, undefined)).toEqual({
      errorCode: 'HTTP_500',
      retryable: true,
      tokenIsDead: false
    })
    expect(classifyApnsResponse(400, undefined)).toMatchObject({ errorCode: 'HTTP_400', retryable: false })
  })
})

describe('apns provider token', () => {
  it('is an ES256 JWS Apple can verify with the key on file', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })

    const token = buildProviderToken(privateKey, 'ABC123DEFG', 'TEAM000000', 1_700_000_000)

    const [header, claims, signature] = token.split('.')
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'ABC123DEFG' })
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toEqual({ iss: 'TEAM000000', iat: 1_700_000_000 })
    // JWS carries the raw r||s pair, 64 bytes for P-256; a DER-encoded signature would be
    // accepted by nothing that speaks JWT.
    const raw = Buffer.from(signature, 'base64url')
    expect(raw).toHaveLength(64)
    expect(
      verify('sha256', Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, raw)
    ).toBe(true)
  })
})

describe('apns payload', () => {
  it('carries what the client tap handler reads and drops what iOS cannot show', () => {
    const payload = buildPayload({
      token: 'a'.repeat(64),
      pushId: 'push_1',
      campaignKey: 'spring-event',
      title: 'Come back',
      body: 'Something is happening',
      deepLink: 'decentraland://open?position=0,0&push_campaign_id=spring-event&push_id=push_1&source=push',
      imageUrl: 'https://example.com/banner.png',
      category: 'liveops',
      ttlSeconds: 86400
    })

    expect(payload.aps.alert).toEqual({ title: 'Come back', body: 'Something is happening' })
    expect(payload).toMatchObject({
      deep_link: 'decentraland://open?position=0,0&push_campaign_id=spring-event&push_id=push_1&source=push',
      push_id: 'push_1',
      push_campaign_id: 'spring-event'
    })
    // No Notification Service Extension on the client, so an image would only make the
    // request fail for the whole campaign.
    expect(JSON.stringify(payload)).not.toContain('banner.png')
  })
})
