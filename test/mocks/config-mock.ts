import { IConfigComponent } from '@well-known-components/interfaces'

export function createConfigJestMockComponent(values: Record<string, string | undefined> = {}): jest.Mocked<IConfigComponent> {
  return {
    getString: jest.fn().mockImplementation((key: string) => Promise.resolve(values[key])),
    getNumber: jest.fn().mockImplementation((key: string) => {
      const val = values[key]
      return Promise.resolve(val ? Number(val) : undefined)
    }),
    requireString: jest.fn().mockImplementation((key: string) => {
      const val = values[key]
      if (val === undefined) throw new Error(`Missing required config: ${key}`)
      return Promise.resolve(val)
    }),
    requireNumber: jest.fn().mockImplementation((key: string) => {
      const val = values[key]
      if (val === undefined) throw new Error(`Missing required config: ${key}`)
      return Promise.resolve(Number(val))
    })
  }
}
