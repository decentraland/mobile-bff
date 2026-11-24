import { IContentPolicyComponent } from '../../src/adapters/content-policy'
import { BlockIndex, emptyBlockIndex } from '../../src/logic/content-policy'

export function createContentPolicyMockComponent(
  options: { blockList?: boolean; index?: Partial<BlockIndex> } = {}
): jest.Mocked<IContentPolicyComponent> {
  return {
    isBlockListEnabled: jest.fn().mockResolvedValue(options.blockList ?? false),
    getBlockIndex: jest.fn().mockResolvedValue({ ...emptyBlockIndex(), ...options.index })
  }
}
