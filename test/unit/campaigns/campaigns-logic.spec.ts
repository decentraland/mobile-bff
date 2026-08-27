import {
  validateToken,
  validateTarget,
  parseTimestamp,
  validateWindow,
  WORLD_NAME_REGEX
} from '../../../src/logic/campaigns'

describe('campaigns logic', () => {
  describe('validateToken', () => {
    it('accepts kebab-case tokens and rejects everything else', () => {
      expect(validateToken('summer-26')).toBeNull()
      expect(validateToken('summer26')).toBeNull()

      expect(validateToken('Summer-26')).toMatch(/kebab-case/)
      expect(validateToken('summer_26')).toMatch(/kebab-case/)
      expect(validateToken('summer 26')).toMatch(/kebab-case/)
      expect(validateToken('')).toMatch(/required/)
      expect(validateToken(42)).toMatch(/required/)
      expect(validateToken('a'.repeat(65))).toMatch(/at most 64/)
    })
  })

  describe('validateTarget', () => {
    it('canonicalizes a genesis target and nulls the world column', () => {
      expect(validateTarget({ targetType: 'genesis', targetPosition: '-9,-9' })).toEqual({
        targetType: 'genesis',
        targetPosition: '-9,-9',
        targetWorld: null
      })
    })

    it('canonicalizes a world target and nulls the position column', () => {
      expect(validateTarget({ targetType: 'world', targetWorld: 'myworld.dcl.eth' })).toEqual({
        targetType: 'world',
        targetPosition: null,
        targetWorld: 'myworld.dcl.eth'
      })
    })

    it('rejects a target that mixes both column families', () => {
      expect(validateTarget({ targetType: 'genesis', targetPosition: '0,0', targetWorld: 'w.dcl.eth' }))
        .toEqual({ error: "'targetWorld' is only valid when targetType is 'world'" })
      expect(validateTarget({ targetType: 'world', targetWorld: 'w.dcl.eth', targetPosition: '0,0' }))
        .toEqual({ error: "'targetPosition' is only valid when targetType is 'genesis'" })
    })

    it('rejects malformed parcels', () => {
      for (const position of ['9', '9,', 'a,b', '9, 9', '99999,0', '']) {
        expect(validateTarget({ targetType: 'genesis', targetPosition: position }))
          .toHaveProperty('error')
      }
    })

    // The client only takes the join_world branch for names matching Realm.is_dcl_ens
    // (godot/src/logic/realm.gd). Anything else is treated as a realm URL and would not
    // resolve to the intended world — so it must not be storable.
    it('rejects world names the client could not resolve', () => {
      for (const name of ['myworld', 'myworld.eth', 'my-world.dcl.eth', 'sub.myworld.dcl.eth', '']) {
        expect(validateTarget({ targetType: 'world', targetWorld: name })).toHaveProperty('error')
      }
      expect(WORLD_NAME_REGEX.test('myworld.dcl.eth')).toBe(true)
    })

    it('rejects an unknown targetType', () => {
      expect(validateTarget({ targetType: 'parcel', targetPosition: '0,0' })).toHaveProperty('error')
      expect(validateTarget({})).toHaveProperty('error')
    })
  })

  describe('window', () => {
    it('parses ISO timestamps and treats absent bounds as open-ended', () => {
      expect(parseTimestamp(undefined, 'startsAt')).toEqual({ value: null })
      expect(parseTimestamp(null, 'startsAt')).toEqual({ value: null })
      expect(parseTimestamp('2026-09-01T00:00:00.000Z', 'startsAt')).toEqual({
        value: new Date('2026-09-01T00:00:00.000Z')
      })
      expect(parseTimestamp('not-a-date', 'startsAt')).toHaveProperty('error')
      expect(parseTimestamp(1787616000000, 'startsAt')).toHaveProperty('error')
    })

    it('requires endsAt to be strictly after startsAt', () => {
      const start = new Date('2026-09-01T00:00:00.000Z')
      const end = new Date('2026-09-30T00:00:00.000Z')

      expect(validateWindow(start, end)).toBeNull()
      expect(validateWindow(null, end)).toBeNull()
      expect(validateWindow(start, null)).toBeNull()
      expect(validateWindow(null, null)).toBeNull()

      expect(validateWindow(end, start)).toMatch(/must be after/)
      expect(validateWindow(start, start)).toMatch(/must be after/)
    })
  })
})
