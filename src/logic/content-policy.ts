import type { Place } from '../adapters/places-db'

// The tag iOS clients send on every Discover request. With the block list on it no longer
// restricts results to the places tagged with it: it marks the request as one to filter, and a
// place tagged with it stays listed even when the rules below would hide it.
export const ALLOWED_IOS_TAG = 'allowed_ios'

// The manual block list: places tagged with it in the backoffice, on top of the rules below.
// It wins over `allowed_ios`.
export const BANNED_IOS_TAG = 'banned_ios'

// Seeded on, so a missing row or an unreadable flag also means the block list.
export const IOS_BLOCKLIST_FLAG = 'ios-blocklist'

// App Store 1.1 / 5.3: gambling and adult content. `R` (restricted) is stricter than `A`.
// Unrated places (`RP` from the scene, `PR` as the Places default) are allowed.
export const BLOCKED_CATEGORIES = ['casino']
export const BLOCKED_RATINGS = ['A', 'R']

type PlaceSet = {
  parcels: Set<string>
  // Lowercased `.dcl.eth` names
  worlds: Set<string>
}

export type BlockIndex = PlaceSet & {
  placeIds: Set<string>
  // The places tagged `allowed_ios`, which the rules leave listed
  allowed: PlaceSet
}

// The fields of a Places destination the rules read; the rest of the row passes through.
export type DestinationRow = {
  id: string
  world?: boolean
  world_name?: string | null
  base_position?: string | null
  positions?: unknown
  categories?: unknown
  content_rating?: unknown
}

export type EventRow = {
  place_id?: unknown
  world?: boolean
  server?: unknown
  position?: unknown
}

export function emptyBlockIndex(): BlockIndex {
  return {
    placeIds: new Set(),
    parcels: new Set(),
    worlds: new Set(),
    allowed: { parcels: new Set(), worlds: new Set() }
  }
}

export function isBlockedByRule(destination: DestinationRow): boolean {
  const categories = Array.isArray(destination.categories) ? destination.categories : []
  return (
    categories.some((category) => BLOCKED_CATEGORIES.includes(String(category).toLowerCase())) ||
    BLOCKED_RATINGS.includes(String(destination.content_rating ?? '').toUpperCase())
  )
}

function parcelsOf(destination: DestinationRow): string[] {
  const positions = Array.isArray(destination.positions)
    ? destination.positions.filter((p): p is string => typeof p === 'string')
    : []
  return destination.base_position ? [destination.base_position, ...positions] : positions
}

function addPlace(set: PlaceSet, place: Place): void {
  if (place.type === 'world') {
    if (place.worldName) {
      set.worlds.add(place.worldName.toLowerCase())
    }
    return
  }
  for (const parcel of place.positions) {
    set.parcels.add(parcel)
  }
  if (place.basePosition) {
    set.parcels.add(place.basePosition)
  }
}

// A world by name, a scene by any parcel it shares, so a redeploy that moved the base still matches
function covers(set: PlaceSet, destination: DestinationRow): boolean {
  if (destination.world_name) {
    return set.worlds.has(destination.world_name.toLowerCase())
  }
  return parcelsOf(destination).some((parcel) => set.parcels.has(parcel))
}

// Everything iOS keeps out: the upstream catalog matched against the rules, minus the places
// tagged `allowed_ios`, plus the places tagged `banned_ios` in the BFF's own place table.
export function buildBlockIndex(catalog: DestinationRow[], banned: Place[], allowed: Place[]): BlockIndex {
  const index = emptyBlockIndex()

  for (const place of allowed) {
    addPlace(index.allowed, place)
  }

  for (const destination of catalog) {
    if (!isBlockedByRule(destination) || covers(index.allowed, destination)) {
      continue
    }
    index.placeIds.add(destination.id)
    if (destination.world) {
      if (destination.world_name) {
        index.worlds.add(destination.world_name.toLowerCase())
      }
    } else {
      for (const parcel of parcelsOf(destination)) {
        index.parcels.add(parcel)
      }
    }
  }

  for (const place of banned) {
    addPlace(index, place)
  }

  return index
}

export function isDestinationBlocked(destination: DestinationRow, index: BlockIndex): boolean {
  if (index.placeIds.has(destination.id) || covers(index, destination)) {
    return true
  }
  return isBlockedByRule(destination) && !covers(index.allowed, destination)
}

export function isEventBlocked(event: EventRow, index: BlockIndex): boolean {
  if (typeof event.place_id === 'string' && index.placeIds.has(event.place_id)) {
    return true
  }
  // A world event carries a placeholder `[0, 0]` position: its world is the server name.
  if (event.world) {
    return typeof event.server === 'string' && index.worlds.has(event.server.toLowerCase())
  }
  if (Array.isArray(event.position) && event.position.length === 2) {
    return index.parcels.has(`${event.position[0]},${event.position[1]}`)
  }
  return false
}
