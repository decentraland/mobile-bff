// Campaign token → target scene mapping (godot-explorer issue #2669).
//
// The token is opaque on purpose: it travels in the ad / referrer link as `?c=<token>`
// and is resolved here, so marketing can repoint a live campaign without an app release
// and without touching the ad platform.
//
// A campaign is always a destination: an attributed install boots straight into the
// target and skips the FTUE. An install with no campaign — or one whose token does not
// resolve — gets today's FTUE, unchanged.

export const TOKEN_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/
export const TOKEN_MAX_LENGTH = 64

export const TARGET_TYPES = ['genesis', 'world'] as const
export type TargetType = (typeof TARGET_TYPES)[number]

// Genesis City parcel as "x,y". Mirrors the CHECK constraint on the campaigns table.
export const POSITION_REGEX = /^-?[0-9]{1,4},-?[0-9]{1,4}$/
export const POSITION_ABS_MAX = 9999

// Mirrors Realm.is_dcl_ens in godot-explorer (godot/src/logic/realm.gd:31) exactly.
// A world name that does not match it falls through the client's join_world branch and
// gets treated as a realm URL instead — which is the "unresolvable scene" this rejects.
export const WORLD_NAME_REGEX = /^[a-zA-Z0-9]+\.dcl\.eth$/

export type CampaignTarget = {
  targetType: TargetType
  targetPosition: string | null
  targetWorld: string | null
}

export function validateToken(token: unknown): string | null {
  if (typeof token !== 'string' || token.trim().length === 0) {
    return "'token' is required and must be a non-empty string"
  }
  if (token.length > TOKEN_MAX_LENGTH) {
    return `'token' must be at most ${TOKEN_MAX_LENGTH} characters`
  }
  if (!TOKEN_REGEX.test(token)) {
    return "'token' must be kebab-case (lowercase letters, digits and dashes, e.g. 'summer-26')"
  }
  return null
}

// Validates the target and returns the canonical column triple. Format-level only:
// it guarantees the client can *route* the target, not that a scene is deployed there.
export function validateTarget(input: {
  targetType?: unknown
  targetPosition?: unknown
  targetWorld?: unknown
}): CampaignTarget | { error: string } {
  const { targetType, targetPosition, targetWorld } = input

  if (typeof targetType !== 'string' || !TARGET_TYPES.includes(targetType as TargetType)) {
    return { error: `'targetType' must be one of: ${TARGET_TYPES.join(', ')}` }
  }
  const type = targetType as TargetType

  if (type === 'genesis') {
    if (targetWorld !== undefined && targetWorld !== null) {
      return { error: "'targetWorld' is only valid when targetType is 'world'" }
    }
    if (typeof targetPosition !== 'string' || !POSITION_REGEX.test(targetPosition)) {
      return { error: "'targetPosition' must be a parcel like '-9,-9'" }
    }
    const [x, y] = targetPosition.split(',').map(Number)
    if (Math.abs(x) > POSITION_ABS_MAX || Math.abs(y) > POSITION_ABS_MAX) {
      return { error: `'targetPosition' coordinates must be within ±${POSITION_ABS_MAX}` }
    }
    return { targetType: type, targetPosition, targetWorld: null }
  }

  if (targetPosition !== undefined && targetPosition !== null) {
    return { error: "'targetPosition' is only valid when targetType is 'genesis'" }
  }
  if (typeof targetWorld !== 'string' || !WORLD_NAME_REGEX.test(targetWorld)) {
    return { error: "'targetWorld' must be a world name like 'myworld.dcl.eth'" }
  }
  return { targetType: type, targetPosition: null, targetWorld }
}
