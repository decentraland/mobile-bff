// Flag names must match the godot-explorer deep-link param style (kebab-case),
// mirroring the CHECK constraint on the feature_flags table
export const FLAG_NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/
export const FLAG_NAME_MAX_LENGTH = 64
export const FLAG_DESCRIPTION_MAX_LENGTH = 500
export const FLAG_VALUE_MAX_LENGTH = 500

export const FLAG_TYPES = ['on-off', 'text', 'number'] as const
export type FlagType = (typeof FLAG_TYPES)[number]

// Mirrors the CHECK constraint on the feature_flags table: plain decimals only,
// no scientific notation (godot-explorer parses these with a simple to_float)
export const NUMBER_VALUE_REGEX = /^-?[0-9]+(\.[0-9]+)?$/

export function validateFlagName(name: unknown): string | null {
  if (typeof name !== 'string' || name.trim().length === 0) {
    return "'name' is required and must be a non-empty string"
  }
  if (name.length > FLAG_NAME_MAX_LENGTH) {
    return `'name' must be at most ${FLAG_NAME_MAX_LENGTH} characters`
  }
  if (!FLAG_NAME_REGEX.test(name)) {
    return "'name' must be kebab-case (lowercase letters, digits and dashes, e.g. 'dual-channel')"
  }
  return null
}

export function validateFlagDescription(description: unknown): string | null {
  if (description !== null && typeof description !== 'string') {
    return "'description' must be a string or null"
  }
  if (typeof description === 'string' && description.length > FLAG_DESCRIPTION_MAX_LENGTH) {
    return `'description' must be at most ${FLAG_DESCRIPTION_MAX_LENGTH} characters`
  }
  return null
}

export function validateFlagType(type: unknown): string | null {
  if (typeof type !== 'string' || !FLAG_TYPES.includes(type as FlagType)) {
    return `'type' must be one of: ${FLAG_TYPES.join(', ')}`
  }
  return null
}

// Validates a value for a text/number flag and returns the canonical string
// stored in the db ('0.10' -> '0.1'). Number flags accept both JSON numbers
// and numeric strings so backoffice textfields can submit either.
export function normalizeFlagValue(type: FlagType, value: unknown): { value: string } | { error: string } {
  if (type === 'on-off') {
    return { error: "on-off flags use 'enabled', not 'value'" }
  }

  if (type === 'text') {
    if (typeof value !== 'string') {
      return { error: "'value' must be a string for text flags" }
    }
    if (value.length > FLAG_VALUE_MAX_LENGTH) {
      return { error: `'value' must be at most ${FLAG_VALUE_MAX_LENGTH} characters` }
    }
    return { value }
  }

  // type === 'number'
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !NUMBER_VALUE_REGEX.test(String(value))) {
      return { error: "'value' must be a plain decimal number (e.g. 1, 0.1)" }
    }
    return { value: String(value) }
  }
  if (typeof value === 'string' && NUMBER_VALUE_REGEX.test(value)) {
    const canonical = String(Number(value))
    // Numbers big enough to canonicalize to scientific notation would break
    // the db CHECK constraint (and any client parsing plain decimals)
    if (NUMBER_VALUE_REGEX.test(canonical)) {
      return { value: canonical }
    }
  }
  return { error: "'value' must be a plain decimal number (e.g. 1, 0.1)" }
}
