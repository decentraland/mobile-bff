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
  if (soc.length > SOC_MAX_LENGTH) {
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

// Only handles case here (trim + uppercase). Whitespace-insensitivity is a separate concern
// handled at the db layer (device-support-db.ts's soc_key generated column, backed by a unique
// index), not here -- 18 of the 320 seeded socs have an internal space (e.g. "EXYNOS 7420"), and
// callers should not assume this function's output is what actually gets matched against.
// The exact string the client sends can't be verified from this repo (the godot-explorer side of
// this feature isn't committed there yet), so treat this as a best-effort normalization, not a
// guarantee: device_support_lookup_total{found=false} (see the adapter) is what actually catches
// a real-world mismatch this function doesn't anticipate.
export function normalizeSoc(soc: string): string {
  return soc.trim().toUpperCase()
}
