// Native fetch (undici) keeps the underlying socket pinned to the response
// until its body is read or explicitly cancelled. When a caller discards a
// response without reading the body (a non-ok early return, a fire-and-forget
// POST, or only inspecting `.status`/headers), the socket leaks and the
// connection pool can be exhausted. Draining cancels the body so the socket
// is released back to the pool.
export async function drainResponse(response: {
  bodyUsed: boolean
  body?: { cancel(): Promise<void> } | null
}): Promise<void> {
  if (!response.bodyUsed) {
    await response.body?.cancel().catch(() => undefined)
  }
}
