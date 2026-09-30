// Backs godot-explorer's device-support-modals feature: instead of shipping the client a full
// list of chipsets to check locally, the client sends the one SoC identifier it detected and
// this service answers whether that specific device is excluded, below minimum spec, or fine.
// A SoC absent from the table is implicitly 'keep' — only the non-default decisions are stored.

export const SOC_MAX_LENGTH = 64
export const DECISIONS = ['exclude', 'below-minspec'] as const
export type Decision = (typeof DECISIONS)[number]

// The public response also uses 'keep' for a SoC with no override row.
export const PUBLIC_DECISIONS = [...DECISIONS, 'keep'] as const
export type PublicDecision = (typeof PUBLIC_DECISIONS)[number]

export function validateSoc(soc: unknown): string | null {
  if (typeof soc !== 'string' || soc.trim().length === 0) {
    return "'soc' is required and must be a non-empty string"
  }
  // Length-checks the trimmed value, matching what normalizeSoc actually stores -- checking the
  // raw string would reject input that only exceeds the limit because of leading/trailing
  // whitespace that never reaches the database.
  if (soc.trim().length > SOC_MAX_LENGTH) {
    return `'soc' must be at most ${SOC_MAX_LENGTH} characters`
  }
  return null
}

export function validateDecision(decision: unknown): string | null {
  if (typeof decision !== 'string' || !DECISIONS.includes(decision as Decision)) {
    return `'decision' must be one of: ${DECISIONS.join(', ')}`
  }
  return null
}

// Bulk entries may also carry 'keep' -- see BulkUpsertEntry in device-support-db.ts, where it
// means "delete this row if present" rather than "store it".
export function validatePublicDecision(decision: unknown): string | null {
  if (typeof decision !== 'string' || !PUBLIC_DECISIONS.includes(decision as PublicDecision)) {
    return `'decision' must be one of: ${PUBLIC_DECISIONS.join(', ')}`
  }
  return null
}

// Case-folds and trims for display/storage (soc_model keeps its natural spacing).
export function normalizeSoc(soc: string): string {
  return soc.trim().toUpperCase()
}

// Mirrors the db's soc_key generated column (UPPER(REPLACE(TRIM(soc_model), ' ', ''))). The one
// place that derives the matching key, so lookups, upserts, deletes and the bulk dedupe can never
// drift from what ON CONFLICT (soc_key) actually matches against.
export function toSocKey(soc: string): string {
  return normalizeSoc(soc).replace(/ /g, '')
}
