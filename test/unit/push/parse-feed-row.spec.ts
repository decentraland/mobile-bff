import { parseFeedRow } from '../../../src/adapters/push-feed'
import { SnowflakeRow } from '../../../src/adapters/snowflake'

// The feed is another system's output reaching this one over a wire, so every row is checked
// rather than trusted. These are the rejections, each named by the reason the sync reports.
describe('parseFeedRow', () => {
  const valid: SnowflakeRow = {
    campaign_key: 'd3-comeback',
    visitor_id: '258554c8-18c5-4bc1-9f0e-3f2b1c7d4a55',
    push_token: '0ebb9a30cef125d6c1',
    push_platform: 'ios',
    deep_link: 'decentraland://open?position=-7,-2',
    image_url: 'https://example.com/plaza.png',
    send_at: '2026-10-04T22:00:00Z'
  }

  it('accepts a row the warehouse produced and normalises its instant', () => {
    expect(parseFeedRow(valid)).toEqual({
      entry: {
        campaignKey: 'd3-comeback',
        userId: '258554c8-18c5-4bc1-9f0e-3f2b1c7d4a55',
        token: '0ebb9a30cef125d6c1',
        platform: 'ios',
        deepLink: 'decentraland://open?position=-7,-2',
        imageUrl: 'https://example.com/plaza.png',
        sendAt: '2026-10-04T22:00:00.000Z'
      }
    })
  })

  it('treats a missing image as no image rather than an empty string', () => {
    expect(parseFeedRow({ ...valid, image_url: null })).toMatchObject({ entry: { imageUrl: null } })
    expect(parseFeedRow({ ...valid, image_url: '   ' })).toMatchObject({ entry: { imageUrl: null } })
  })

  it('accepts a row with no instant, which is sent as soon as the campaign allows', () => {
    expect(parseFeedRow({ ...valid, send_at: null })).toMatchObject({ entry: { sendAt: null } })
  })

  it.each([
    // Underscores are what the warehouse used to emit; the campaign key constraint here
    // admits kebab-case only, so a row naming one could never match a campaign.
    ['campaign_key', { campaign_key: 'd3_comeback' }],
    ['campaign_key', { campaign_key: '' }],
    ['visitor_id', { visitor_id: '  ' }],
    ['push_token', { push_token: null }],
    ['push_platform', { push_platform: 'web' }],
    ['deep_link_scheme', { deep_link: 'https://decentraland.org/play' }],
    // Reachable shapes the campaign allow-list refuses: `dclenv` signs the user out and
    // `realm` on the wrong host is not a route the client treats as "go here".
    ['deep_link_route', { deep_link: 'decentraland://open?dclenv=zone' }],
    ['deep_link_route', { deep_link: 'decentraland://preview?realm=foo' }],
    ['send_at', { send_at: 'tomorrow evening' }]
  ])('refuses a row for %s', (reason, override) => {
    expect(parseFeedRow({ ...valid, ...override })).toEqual({ reason })
  })
})
