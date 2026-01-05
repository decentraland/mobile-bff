import { Router } from "@well-known-components/http-server"
import { wellKnownComponents as signedFetchMiddleware } from '@dcl/platform-crypto-middleware'
import { GlobalContext } from "../types"
import { pingHandler } from "./handlers/ping-handler"
import { requestDeletionHandler } from "./handlers/request-deletion-handler"
import { getDeletionStatusHandler } from "./handlers/get-deletion-status-handler"
import { cancelDeletionHandler } from "./handlers/cancel-deletion-handler"

// Scene Groups handlers (public)
import { getSceneGroupsHandler } from "./handlers/scene-groups/get-scene-groups-handler"
import { getSceneGroupHandler } from "./handlers/scene-groups/get-scene-group-handler"

// Scene Groups handlers (backoffice)
import { createSceneGroupHandler } from "./handlers/backoffice/scene-groups/create-scene-group-handler"
import { getBackofficeSceneGroupsHandler } from "./handlers/backoffice/scene-groups/get-scene-groups-handler"
import { updateSceneGroupHandler } from "./handlers/backoffice/scene-groups/update-scene-group-handler"
import { deleteSceneGroupHandler } from "./handlers/backoffice/scene-groups/delete-scene-group-handler"

// Bans handlers (backoffice)
import { getBansHandler } from "./handlers/backoffice/bans/get-bans-handler"
import { createBanHandler } from "./handlers/backoffice/bans/create-ban-handler"
import { deleteBanHandler } from "./handlers/backoffice/bans/delete-ban-handler"

// Hub frontend (static files)
import { hubStaticHandler } from "./handlers/hub-static-handler"

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

  // === Scene Groups API ===

  // Public read-only endpoints (for mobile app)
  router.get("/scene-groups", getSceneGroupsHandler)
  router.get("/scene-groups/:id", getSceneGroupHandler)

  // Backoffice endpoints (require signed fetch + ALLOWED_USERS)
  router.get("/backoffice/scene-groups", signedFetch, getBackofficeSceneGroupsHandler)
  router.post("/backoffice/scene-groups", signedFetch, createSceneGroupHandler)
  router.put("/backoffice/scene-groups/:id", signedFetch, updateSceneGroupHandler)
  router.delete("/backoffice/scene-groups/:id", signedFetch, deleteSceneGroupHandler)

  // Bans management (backoffice)
  router.get("/backoffice/bans", signedFetch, getBansHandler)
  router.post("/backoffice/bans", signedFetch, createBanHandler)
  router.delete("/backoffice/bans/:id", signedFetch, deleteBanHandler)

  // Hub frontend (static files)
  router.get("/hub", hubStaticHandler)
  router.get("/hub/(.*)", hubStaticHandler)

  return router
}
