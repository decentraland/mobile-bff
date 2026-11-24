import {
  buildBlockIndex,
  emptyBlockIndex,
  isBlockedByRule,
  isDestinationBlocked,
  isEventBlocked
} from '../../../src/logic/content-policy'
import { createTestPlace, createTestWorldPlace } from '../../mocks/places-db-mock'

describe('content-policy rules', () => {
  describe('isBlockedByRule', () => {
    it('should block the casino category and the A and R ratings', () => {
      expect(isBlockedByRule({ id: '1', categories: ['game', 'casino'] })).toBe(true)
      expect(isBlockedByRule({ id: '2', content_rating: 'A' })).toBe(true)
      expect(isBlockedByRule({ id: '3', content_rating: 'R' })).toBe(true)
    })

    it('should allow unrated, everyone and teen places', () => {
      for (const content_rating of ['RP', 'PR', 'E', 'T', undefined, null]) {
        expect(isBlockedByRule({ id: 'x', content_rating, categories: ['art'] })).toBe(false)
      }
    })

    it('should tolerate rows without categories', () => {
      expect(isBlockedByRule({ id: 'x', categories: 'casino' })).toBe(false)
    })
  })

  describe('buildBlockIndex', () => {
    it('should index every parcel of a rule-blocked scene and the name of a rule-blocked world', () => {
      const index = buildBlockIndex(
        [
          { id: 'scene', base_position: '1,1', positions: ['1,1', '1,2'], content_rating: 'A' },
          { id: 'world', world: true, world_name: 'Sin.dcl.eth', categories: ['casino'] },
          { id: 'fine', base_position: '9,9', positions: ['9,9'], content_rating: 'T' }
        ],
        []
      )

      expect(index.placeIds).toEqual(new Set(['scene', 'world']))
      expect(index.parcels).toEqual(new Set(['1,1', '1,2']))
      expect(index.worlds).toEqual(new Set(['sin.dcl.eth']))
    })

    it('should index every parcel of a scene and the name of a world tagged banned_ios', () => {
      const banned = [
        createTestPlace({ id: 'scene', basePosition: '5,5', positions: ['5,5', '5,6'] }),
        createTestWorldPlace({ id: 'world', worldName: 'Banned.dcl.eth' })
      ]

      const index = buildBlockIndex([], banned)

      expect(index.parcels).toEqual(new Set(['5,5', '5,6']))
      expect(index.worlds).toEqual(new Set(['banned.dcl.eth']))
      // The BFF's own place ids are not Places ids
      expect(index.placeIds.size).toBe(0)
    })
  })

  describe('isDestinationBlocked', () => {
    const index = {
      ...emptyBlockIndex(),
      placeIds: new Set(['by-id']),
      parcels: new Set(['4,5']),
      worlds: new Set(['sin.dcl.eth'])
    }

    it('should block by rule, by id, by any parcel and by world name', () => {
      expect(isDestinationBlocked({ id: 'r', content_rating: 'A' }, index)).toBe(true)
      expect(isDestinationBlocked({ id: 'by-id' }, index)).toBe(true)
      expect(isDestinationBlocked({ id: 'p', base_position: '4,4', positions: ['4,4', '4,5'] }, index)).toBe(true)
      expect(isDestinationBlocked({ id: 'w', world: true, world_name: 'SIN.dcl.eth' }, index)).toBe(true)
    })

    it('should let everything else through', () => {
      expect(isDestinationBlocked({ id: 'p', base_position: '4,4', positions: ['4,4'] }, index)).toBe(false)
      expect(isDestinationBlocked({ id: 'w', world: true, world_name: 'fine.dcl.eth' }, index)).toBe(false)
    })
  })

  describe('isEventBlocked', () => {
    const index = {
      ...emptyBlockIndex(),
      placeIds: new Set(['blocked']),
      parcels: new Set(['0,0']),
      worlds: new Set(['sin.dcl.eth'])
    }

    it('should block by place id, parcel and world server', () => {
      expect(isEventBlocked({ place_id: 'blocked', position: [9, 9] }, index)).toBe(true)
      expect(isEventBlocked({ position: [0, 0] }, index)).toBe(true)
      expect(isEventBlocked({ world: true, server: 'Sin.dcl.eth', position: [0, 0] }, index)).toBe(true)
    })

    it('should not read the placeholder position of a world event', () => {
      expect(isEventBlocked({ world: true, server: 'fine.dcl.eth', position: [0, 0] }, index)).toBe(false)
    })
  })
})
