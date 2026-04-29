import { getDiscoverFeaturedScenesHandler } from "../../../src/controllers/handlers/discover-featured/get-discover-featured-scenes-handler"

describe("get-discover-featured-scenes-handler", () => {
  it("returns the hardcoded list of featured scenes", async () => {
    const result = await getDiscoverFeaturedScenesHandler({} as any)

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    expect(Array.isArray(result.body.data)).toBe(true)
    expect(result.body.data.length).toBeGreaterThan(0)

    for (const scene of result.body.data) {
      expect(typeof scene.title).toBe("string")
      expect(typeof scene.description).toBe("string")
      expect(typeof scene.imageUrl).toBe("string")
      expect(typeof scene.realm).toBe("string")
      expect(scene.realm.length).toBeGreaterThan(0)

      if (scene.base_position !== undefined) {
        expect(scene.base_position).toMatch(/^-?\d+,-?\d+$/)
      }
    }
  })
})
