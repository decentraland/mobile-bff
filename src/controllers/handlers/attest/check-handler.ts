import { HandlerContextWithPath } from '../../../types'

// POST /v1/attest/check — non-gating verdict endpoint.
//
// The client sends the SAME headers + raw body it uses for sign-message; we
// run the platform attestation verification and report the outcome in the
// response. ALWAYS returns 200 — analytics downstream parses the body shape
// to compute pass rates. Failing here is informational, not user-facing.
//
// Response shape:
//   {
//     ok: boolean,
//     platform: "ios" | "android" | "unknown",
//     code: "OK" | "<ATTESTATION_*>",
//     error?: string,
//     verdicts?: string[],            // Android only, on success
//     details?: unknown,              // platform-specific extras
//     elapsed_ms: number
//   }
export async function attestCheckHandler(
  context: HandlerContextWithPath<'attestationVerifier', '/v1/attest/check'>
) {
  const {
    components: { attestationVerifier },
    request
  } = context
  const start = Date.now()

  let rawBody: Buffer
  try {
    rawBody = Buffer.from(await request.arrayBuffer())
  } catch {
    rawBody = Buffer.alloc(0)
  }

  const outcome = await attestationVerifier.verify({ headers: request.headers, rawBody })
  const body: Record<string, unknown> = {
    ok: outcome.ok,
    platform: outcome.platform,
    code: outcome.code,
    elapsed_ms: Date.now() - start
  }
  if (outcome.error !== undefined) body.error = outcome.error
  if (outcome.details !== undefined) body.details = outcome.details
  if (outcome.verdicts !== undefined) body.verdicts = outcome.verdicts
  if (outcome.keyIdPrefix !== undefined) body.key_id_prefix = outcome.keyIdPrefix
  return { status: 200, body }
}
