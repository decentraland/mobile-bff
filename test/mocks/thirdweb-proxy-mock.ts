import { IThirdwebProxyComponent } from '../../src/adapters/thirdweb-proxy'

export function createThirdwebProxyJestMockComponent(
  overrides: Partial<jest.Mocked<IThirdwebProxyComponent>> = {}
): jest.Mocked<IThirdwebProxyComponent> {
  return {
    forwardSignMessage: jest.fn().mockResolvedValue({
      status: 200,
      contentType: 'application/json',
      body: Buffer.from('{"signature":"0xdeadbeef"}', 'utf8')
    }),
    ...overrides
  }
}
