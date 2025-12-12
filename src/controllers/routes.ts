import { Router } from "@well-known-components/http-server"
import { wellKnownComponents as signedFetchMiddleware } from '@dcl/platform-crypto-middleware'
import { GlobalContext } from "../types"
import { pingHandler } from "./handlers/ping-handler"
import { requestDeletionHandler } from "./handlers/request-deletion-handler"
import { getDeletionStatusHandler } from "./handlers/get-deletion-status-handler"
import { cancelDeletionHandler } from "./handlers/cancel-deletion-handler"

// We return the entire router because it will be easier to test than a whole server
export async function setupRouter(globalContext: GlobalContext): Promise<Router<GlobalContext>> {
  const router = new Router<GlobalContext>()

  const { fetch } = globalContext.components

  const signedFetch = signedFetchMiddleware({
    fetcher: fetch,
    optional: false,
    onError: (err: any) => ({
      error: err.message,
      message: 'This endpoint requires a signed fetch request. See ADR-44.'
    })
  })

  router.get("/ping", pingHandler)

  // Deletion account endpoints (all require signed fetch)
  router.post("/deletion", signedFetch, requestDeletionHandler)
  router.get("/deletion", signedFetch, getDeletionStatusHandler)
  router.delete("/deletion", signedFetch, cancelDeletionHandler)

  return router
}
