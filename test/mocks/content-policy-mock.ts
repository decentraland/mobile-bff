import { IContentPolicyComponent } from '../../src/adapters/content-policy'
import { BlockIndex, emptyBlockIndex, PlaceSet } from '../../src/logic/content-policy'

export function createContentPolicyMockComponent(
  options: { blockList?: boolean; index?: Partial<BlockIndex>; banned?: PlaceSet } = {}
): jest.Mocked<IContentPolicyComponent> {
  return {
    isBlockListEnabled: jest.fn().mockResolvedValue(options.blockList ?? false),
    getBlockIndex: jest.fn().mockResolvedValue({ ...emptyBlockIndex(), ...options.index }),
    getBannedPlaces: jest.fn().mockResolvedValue(options.banned ?? null)
  }
}
