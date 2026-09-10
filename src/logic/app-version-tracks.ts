// Track names are part of the public URL (GET /app-versions/:track), so they follow the
// same kebab-case shape enforced by the app_versions_track_format DB constraint.
export const TRACK_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

// Served by the bare GET /app-versions, which is the only thing clients up to 1.13.1 know
// how to call. Its thresholds are effectively frozen — see LEGACY_MINIMAL_VERSION_CAP.
export const LEGACY_TRACK = 'legacy'

// The track clients carrying the overlay fix read. They ask for it by URL, which is the
// only thing that distinguishes them: the fix ships as another 1.13.1 build, so their
// version number is identical to a broken one's.
export const CURRENT_TRACK = 'v2'

// godot-explorer 1.12.0 (101200) through 1.13.1 (101301) put the force-update overlay on a
// CanvasLayer below the startup splash (layer 100) and return from lobby._ready() before
// anything dismisses that splash. A hard gate on those builds is not a dialog — it is an
// unrecoverable startup spinner. The fixed build is also 1.13.1, so this range cannot be
// narrowed by version number; the fixed ones simply never read this track.
//
// Keeping the legacy minimum at or below the oldest broken build guarantees every one of
// them passes the gate (the client compares `current < minimal`). Soft gates are unaffected
// and still work there, so `recommendedVersionNumber` stays unrestricted on this track.
export const OLDEST_BROKEN_OVERLAY_VERSION = 101200
export const LEGACY_MINIMAL_VERSION_CAP = OLDEST_BROKEN_OVERLAY_VERSION

export function isValidTrackName(track: string): boolean {
  return TRACK_NAME_PATTERN.test(track)
}

// Returns an error message when the update would hard-gate a client that cannot render the
// overlay, or null when the update is safe.
export function validateTrackMinimal(track: string, minimal: number, platform: string): string | null {
  if (track !== LEGACY_TRACK || minimal <= LEGACY_MINIMAL_VERSION_CAP) {
    return null
  }
  return (
    `'${platform}.minimalRequiredVersionNumber' cannot exceed ${LEGACY_MINIMAL_VERSION_CAP} on the ` +
    `'${LEGACY_TRACK}' track: clients between 1.12.0 and 1.13.1 hang on the startup spinner instead ` +
    `of showing the update dialog. Raise it on the '${CURRENT_TRACK}' track instead.`
  )
}
