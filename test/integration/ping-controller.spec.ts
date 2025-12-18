import { test } from "../components"

test("integration sanity tests using a real server backend", function ({ components }) {
  it("responds /ping", async () => {
    const { localFetch } = components

    const r = await localFetch.fetch("/ping")

    expect(r.status).toEqual(200)
    expect(await r.text()).toEqual("/ping")
  })

  it("random url responds 404", async () => {
    const { localFetch } = components

    const r = await localFetch.fetch("/ping" + Math.random())

    expect(r.status).toEqual(404)
  })
})
