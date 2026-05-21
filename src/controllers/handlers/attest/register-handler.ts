import { HandlerContextWithPath } from '../../../types'
import { AppAttestError } from '../../../adapters/app-attest'
import { clientKeyFromHeaders } from '../../../adapters/rate-limiter'
import { RL_ATTEST_REGISTER, withFallbackCap } from '../../../logic/rate-limit-rules'

type RegisterBody = {
  key_id?: unknown
  attestation_object?: unknown
  challenge?: unknown
}

// POST /attest/ios/register — finishes the App Attest enrollment ceremony:
// verifies the attestation object against the previously-issued challenge,
// extracts the leaf public key, and stores it under key_id for future
// assertion checks.
//
// Rate limited per IP: registration triggers cert chain verification, ASN.1
// parsing, and a DB insert. Cheap by itself, but spammable enough to be a
// nuisance without a cap. Legitimate use is one call per install.
export async function attestIosRegisterHandler(
  context: HandlerContextWithPath<
    'appAttest' | 'attestationState' | 'logs' | 'rateLimiter',
    '/attest/ios/register'
  >
) {
  const {
    components: { appAttest, attestationState, logs, rateLimiter },
    request
  } = context
  const logger = logs.getLogger('attest-ios-register')

  const { key: ipKey, isFallback } = clientKeyFromHeaders(request.headers, logs.getLogger('rate-limit'))
  const rl = rateLimiter.check(
    withFallbackCap(RL_ATTEST_REGISTER, isFallback),
    `attest:register:${ipKey}`,
    'attest:register'
  )
  if (!rl.allowed) {
    return {
      status: 429,
      headers: { 'Retry-After': String(rl.retryAfterSec) },
      body: { error: 'rate limit exceeded' }
    }
  }

  let body: RegisterBody
  try {
    body = (await request.json()) as RegisterBody
  } catch {
    return { status: 400, body: { error: 'invalid JSON body' } }
  }

  const { key_id, attestation_object, challenge } = body
  if (typeof key_id !== 'string' || typeof attestation_object !== 'string' || typeof challenge !== 'string') {
    return { status: 400, body: { error: 'key_id, attestation_object, challenge are required strings' } }
  }

  const challengeBytes = await attestationState.consumeChallenge(challenge)
  if (!challengeBytes) {
    return { status: 400, body: { error: 'challenge unknown or expired' } }
  }

  const keyIdPrefix = key_id.slice(0, 8)
  try {
    const { publicKeyPem } = appAttest.verifyRegistration({
      keyIdB64u: key_id,
      attestationObjectB64u: attestation_object,
      challengeBytes
    })
    const { inserted } = await attestationState.registerKey(key_id, publicKeyPem)
    if (!inserted) {
      // Row already existed — we deliberately did NOT overwrite it (see
      // registerKey for the replay-protection rationale). Treat as success
      // for the client (the key it just attested is the one we already have,
      // since key_id = SHA256(public key) — and any attempt to register a
      // different public key under the same key_id would imply a hash
      // collision). Warn-log so we can correlate with downstream noise.
      logger.warn('ios key already registered, ignoring re-register', { key_id_prefix: keyIdPrefix })
    } else {
      logger.info('ios key registered', { key_id_prefix: keyIdPrefix })
    }
    return { status: 200, body: { registered: true, key_id_prefix: keyIdPrefix } }
  } catch (e: any) {
    const msg = e instanceof AppAttestError ? e.message : `unexpected: ${e?.message || e}`
    logger.warn('ios key registration failed', { key_id_prefix: keyIdPrefix, error: msg })
    return { status: 400, body: { error: msg } }
  }
}
