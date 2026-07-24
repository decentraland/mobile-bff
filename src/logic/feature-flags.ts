// Flag names must match the godot-explorer deep-link param style (kebab-case),
// mirroring the CHECK constraint on the feature_flags table
export const FLAG_NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/
export const FLAG_NAME_MAX_LENGTH = 64
export const FLAG_DESCRIPTION_MAX_LENGTH = 500

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
