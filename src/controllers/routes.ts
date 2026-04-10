import { Router } from "@well-known-components/http-server"
import { wellKnownComponents as signedFetchMiddleware } from '@dcl/platform-crypto-middleware'
import { GlobalContext } from "../types"
import { pingHandler } from "./handlers/ping-handler"
import { requestDeletionHandler } from "./handlers/request-deletion-handler"
import { getDeletionStatusHandler } from "./handlers/get-deletion-status-handler"
import { cancelDeletionHandler } from "./handlers/cancel-deletion-handler"

// Tags handlers (public)
import { getAllTagsHandler } from "./handlers/tags/get-all-tags-handler"

// Bans handlers (public)
import { getBansHandler } from "./handlers/bans/get-bans-handler"

// Bans handlers (backoffice)
import { getBansHandler as getBackofficeBansHandler } from "./handlers/backoffice/bans/get-bans-handler"
import { createBanHandler } from "./handlers/backoffice/bans/create-ban-handler"
import { deleteBanHandler } from "./handlers/backoffice/bans/delete-ban-handler"

// Tags handlers (backoffice)
import { createTagHandler } from "./handlers/backoffice/tags/create-tag-handler"
import { deleteTagHandler } from "./handlers/backoffice/tags/delete-tag-handler"

// Places handlers (public) - new places model
import { getPlacesHandler } from "./handlers/places-v2/get-places-handler"
import { getPlaceGroupsHandler } from "./handlers/places-v2/get-place-groups-handler"

// Destinations handler (public)
import { getDestinationsHandler } from "./handlers/destinations/get-destinations-handler"

// Events handler (public)
import { getEventsHandler } from "./handlers/events/get-events-handler"

// Places handlers (backoffice) - new places model
import { getBackofficePlacesHandler } from "./handlers/backoffice/places/get-places-handler"
import { createPlaceHandler } from "./handlers/backoffice/places/create-place-handler"
import { updatePlaceHandler } from "./handlers/backoffice/places/update-place-handler"
import { deletePlaceHandler } from "./handlers/backoffice/places/delete-place-handler"
import { setPlaceGroupHandler, removePlaceGroupHandler } from "./handlers/backoffice/places/set-place-group-handler"

// Test auth handlers (Apple review testing)
import { testAuthSendCodeHandler } from "./handlers/test-auth/send-code-handler"
import { testAuthVerifyCodeHandler } from "./handlers/test-auth/verify-code-handler"

// Place Groups handlers (backoffice)
import { getBackofficePlaceGroupsHandler } from "./handlers/backoffice/place-groups/get-place-groups-handler"
import { createPlaceGroupHandler } from "./handlers/backoffice/place-groups/create-place-group-handler"
import { updatePlaceGroupHandler } from "./handlers/backoffice/place-groups/update-place-group-handler"
import { deletePlaceGroupHandler } from "./handlers/backoffice/place-groups/delete-place-group-handler"

// We return the entire router because it will be easier to test than a whole server
export async function setupRouter(globalContext: GlobalContext): Promise<Router<GlobalContext>> {
  const router = new Router<GlobalContext>()

  const { fetch } = globalContext.components

  const signedFetch = signedFetchMiddleware({
    fetcher: fetch,
    optional: true,
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

  // ============== PUBLIC READ-ONLY ENDPOINTS ==============

  // Places API
  router.get("/places", getPlacesHandler)
  router.get("/place-groups", getPlaceGroupsHandler)

  // Destinations API (proxy with caching)
  router.get("/destinations", getDestinationsHandler)

  // Events API (proxy with caching)
  router.get("/events", getEventsHandler)

  // Tags and Bans
  router.get("/tags", getAllTagsHandler)
  router.get("/bans", getBansHandler)

  // ============== TEST AUTH ENDPOINTS ==============
  // Used by Apple App Store reviewers to test login with a controlled OTP code.
  // Only active when TEST_AUTH_EMAIL is configured.
  router.post("/test-auth/send-code", testAuthSendCodeHandler)
  router.post("/test-auth/verify-code", testAuthVerifyCodeHandler)

  // ============== BACKOFFICE ENDPOINTS ==============
  // require signed fetch + ALLOWED_USERS

  // Places management
  router.get("/backoffice/places", signedFetch, getBackofficePlacesHandler)
  router.post("/backoffice/places", signedFetch, createPlaceHandler)
  router.put("/backoffice/places/:id", signedFetch, updatePlaceHandler)
  router.delete("/backoffice/places/:id", signedFetch, deletePlaceHandler)
  router.post("/backoffice/places/:id/group", signedFetch, setPlaceGroupHandler)
  router.delete("/backoffice/places/:id/group", signedFetch, removePlaceGroupHandler)

  // Place Groups management
  router.get("/backoffice/place-groups", signedFetch, getBackofficePlaceGroupsHandler)
  router.post("/backoffice/place-groups", signedFetch, createPlaceGroupHandler)
  router.put("/backoffice/place-groups/:id", signedFetch, updatePlaceGroupHandler)
  router.delete("/backoffice/place-groups/:id", signedFetch, deletePlaceGroupHandler)

  // Bans management
  router.get("/backoffice/bans", signedFetch, getBackofficeBansHandler)
  router.post("/backoffice/bans", signedFetch, createBanHandler)
  router.delete("/backoffice/bans/:id", signedFetch, deleteBanHandler)

  // Tags management
  router.post("/backoffice/tags", signedFetch, createTagHandler)
  router.delete("/backoffice/tags/:id", signedFetch, deleteTagHandler)

  return router
}
