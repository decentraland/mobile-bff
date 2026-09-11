import { parseAudienceCsv, validateCampaignContent } from '../../../src/logic/push'

// The audience is exported from the warehouse by hand and pasted in, so the failure modes
// here are human rather than adversarial. Every one of these cost somebody a campaign that
// silently reached fewer people than they thought.
describe('parseAudienceCsv', () => {
  const TOKEN_A = 'a'.repeat(40)
  const TOKEN_B = 'b'.repeat(40)

  it('reads the shapes a spreadsheet export actually produces', () => {
    const csv = [
      'user_id,fcm_token', // header, sometimes present
      `user-a,${TOKEN_A}`,
      `"user-b","${TOKEN_B}"`, // quoted by the spreadsheet
      '  user-c  ,  ' + TOKEN_A + '  ', // padded by a copy/paste
      '', // trailing newline
      ''
    ].join('\r\n') // exported on Windows

    const { entries, invalid } = parseAudienceCsv(csv)

    expect(invalid).toEqual([])
    expect(entries).toEqual([
      { userId: 'user-a', token: TOKEN_A },
      { userId: 'user-b', token: TOKEN_B },
      { userId: 'user-c', token: TOKEN_A }
    ])
  })

  it('reports bad rows with their line number instead of dropping them', () => {
    const csv = ['user_id,fcm_token', `good,${TOKEN_A}`, 'no-token', `,${TOKEN_B}`, 'empty-token,'].join('\n')

    const { entries, invalid } = parseAudienceCsv(csv)

    expect(entries).toEqual([{ userId: 'good', token: TOKEN_A }])
    // Line numbers are what the operator sees in their editor, header included.
    expect(invalid).toEqual([
      { line: 3, reason: 'expected two comma-separated columns' },
      { line: 4, reason: 'empty user_id' },
      { line: 5, reason: 'empty token' }
    ])
  })

  // The expensive mistake: exporting the columns the other way round parses cleanly, and
  // every send then goes to a "token" that is really a user id — reported as a success.
  it('catches a swapped column order', () => {
    const { entries, invalid } = parseAudienceCsv(`${TOKEN_A},user-a`)

    expect(entries).toEqual([])
    expect(invalid).toEqual([{ line: 1, reason: 'token too short — are the columns swapped?' }])
  })

  it('treats a file with no header as data', () => {
    const { entries } = parseAudienceCsv(`user-a,${TOKEN_A}`)

    expect(entries).toEqual([{ userId: 'user-a', token: TOKEN_A }])
  })
})

describe('validateCampaignContent', () => {
  const valid = {
    title: 'Come back',
    body: 'Something is happening',
    deepLink: 'decentraland://open?position=0,0'
  }

  it('fills in the defaults a campaign relies on', () => {
    const result = validateCampaignContent(valid)

    // 24h rather than FCM's four-week default: without it a Saturday event can land on
    // Tuesday, and the reader has no way to know it was stale.
    expect(result).toEqual({
      content: { ...valid, imageUrl: null, ttlSeconds: 86400, scheduledAt: null }
    })
  })

  it('refuses a link that would fight the sender for its own params', () => {
    for (const deepLink of [
      'decentraland://open?push_id=manual',
      'decentraland://open?source=push',
      'decentraland://open?c=summer-26'
    ]) {
      expect(validateCampaignContent({ ...valid, deepLink })).toHaveProperty('error')
    }
  })
})
