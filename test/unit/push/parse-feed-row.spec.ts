import { parseFeedRow } from '../../../src/adapters/push-feed'
import { SnowflakeRow } from '../../../src/adapters/snowflake'

// The feed is another system's output reaching this one over a wire, so every row is checked
// rather than trusted. These are the rejections, each named by the reason the sync reports.
describe('parseFeedRow', () => {
  const scene: SnowflakeRow = {
    visitor_id: '258554c8-18c5-4bc1-9f0e-3f2b1c7d4a55',
    trigger_key: 'd3',
    destination_kind: 'scene',
    push_token: '0ebb9a30cef125d6c1',
    push_platform: 'ios',
    is_world: 'false',
    world_name: null,
    base_position: '-109,-93',
    place_id: 'c2f9b1a4-7e55-4f0d-9a3c-1b8e6d204f71',
    send_at: '2026-10-04T22:00:00Z'
  }

  it('builds the position link for a Genesis City scene and normalises its instant', () => {
    expect(parseFeedRow(scene)).toEqual({
      entry: {
        userId: '258554c8-18c5-4bc1-9f0e-3f2b1c7d4a55',
        triggerKey: 'd3',
        destinationKind: 'scene',
        token: '0ebb9a30cef125d6c1',
        platform: 'ios',
        deepLink: 'decentraland://open?position=-109,-93',
        placeId: 'c2f9b1a4-7e55-4f0d-9a3c-1b8e6d204f71',
        sendAt: '2026-10-04T22:00:00.000Z'
      }
    })
  })

  it('builds the realm link for a World', () => {
    expect(
      parseFeedRow({ ...scene, is_world: 'true', world_name: 'astrocrew.dcl.eth', base_position: null })
    ).toMatchObject({ entry: { deepLink: 'decentraland://open?realm=astrocrew.dcl.eth' } })
  })

  // plaza and discover are the same destination for everybody, so they carry none of their own
  // and the campaign's link and image are what go out.
  it.each([['plaza'], ['discover']])('leaves a %s row without a destination of its own', (kind) => {
    expect(
      parseFeedRow({
        ...scene,
        destination_kind: kind,
        is_world: null,
        world_name: null,
        base_position: null,
        place_id: null
      })
    ).toMatchObject({ entry: { destinationKind: kind, deepLink: null, placeId: null } })
  })

  it('accepts a row with no instant, which is sent as soon as the campaign allows', () => {
    expect(parseFeedRow({ ...scene, send_at: null })).toMatchObject({ entry: { sendAt: null } })
  })

  it.each([
    ['trigger_key', { trigger_key: '  ' }],
    ['destination_kind', { destination_kind: 'somewhere' }],
    ['visitor_id', { visitor_id: '  ' }],
    ['push_token', { push_token: null }],
    ['push_platform', { push_platform: 'web' }],
    // A scene the warehouse could not express is rejected rather than quietly sent to the
    // campaign's generic link, which would be a push claiming a destination it does not open.
    ['destination_identity', { base_position: null }],
    ['destination_identity', { base_position: 'over there' }],
    ['destination_identity', { is_world: 'true', world_name: null, base_position: null }],
    // A name that could add a query parameter is refused, not escaped.
    ['destination_identity', { is_world: 'true', world_name: 'foo.dcl.eth&dclenv=zone', base_position: null }],
    ['send_at', { send_at: 'tomorrow evening' }]
  ])('refuses a row for %s', (reason, override) => {
    expect(parseFeedRow({ ...scene, ...override })).toEqual({ reason })
  })
})
