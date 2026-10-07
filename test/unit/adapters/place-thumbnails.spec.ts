import { createPlaceThumbnailsComponent } from '../../../src/adapters/place-thumbnails'

// The thumbnail is looked up while a push is being sent, so what matters is that a slow or
// broken catalogue costs the delivery its image and nothing else.
describe('placeThumbnails', () => {
  const PLACE = 'c2f9b1a4-7e55-4f0d-9a3c-1b8e6d204f71'
  const IMAGE = 'https://peer-ec1.decentraland.org/content/contents/bafyplace'

  function components(fetchImpl: jest.Mock) {
    const store = new Map<string, { value: unknown; expiresAt: number }>()
    return {
      fetch: { fetch: fetchImpl } as any,
      config: { getString: async () => undefined } as any,
      cache: {
        get: async (key: string) => {
          const hit = store.get(key)
          return hit && hit.expiresAt > Date.now() ? (hit.value as any) : null
        },
        set: async (key: string, value: unknown, ttlMs: number) => {
          store.set(key, { value, expiresAt: Date.now() + ttlMs })
        },
        invalidate: async () => {},
        clear: async () => {}
      } as any,
      logs: { getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }) } as any
    }
  }

  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })

  it('resolves the image once and serves the rest of the campaign from cache', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(ok({ ok: true, data: { image: IMAGE } }))
    const thumbnails = await createPlaceThumbnailsComponent(components(fetchImpl))

    expect(await thumbnails.get(PLACE)).toBe(IMAGE)
    expect(await thumbnails.get(PLACE)).toBe(IMAGE)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  // A place the catalogue has no image for is a known answer, so it is remembered: otherwise
  // every delivery of the same campaign would ask again.
  it('remembers that a place has no image', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(ok({ ok: true, data: { image: null } }))
    const thumbnails = await createPlaceThumbnailsComponent(components(fetchImpl))

    expect(await thumbnails.get(PLACE)).toBeNull()
    expect(await thumbnails.get(PLACE)).toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  // A failure is about the network, not about the place, so it is not cached — caching it
  // would blank the image for every delivery that follows inside the TTL.
  it('sends no image when the lookup fails, and tries again next time', async () => {
    const fetchImpl = jest
      .fn()
      .mockRejectedValueOnce(new Error('aborted'))
      .mockResolvedValueOnce(ok({ ok: true, data: { image: IMAGE } }))
    const thumbnails = await createPlaceThumbnailsComponent(components(fetchImpl))

    expect(await thumbnails.get(PLACE)).toBeNull()
    expect(await thumbnails.get(PLACE)).toBe(IMAGE)
  })

  it('refuses anything that is not an https image', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(ok({ ok: true, data: { image: 'javascript:alert(1)' } }))
    const thumbnails = await createPlaceThumbnailsComponent(components(fetchImpl))

    expect(await thumbnails.get(PLACE)).toBeNull()
  })
})
