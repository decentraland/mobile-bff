import { HandlerContextWithPath } from '../../../types'
import { AppAttestError } from '../../../adapters/app-attest'

type RegisterBody = {
  key_id?: unknown
  attestation_object?: unknown
  challenge?: unknown
}

// POST /v1/attest/ios/register — finishes the App Attest enrollment ceremony:
// verifies the attestation object against the previously-issued challenge,
// extracts the leaf public key, and stores it under key_id for future
// assertion checks.
export async function attestIosRegisterHandler(
  context: HandlerContextWithPath<'appAttest' | 'attestationState' | 'logs', '/v1/attest/ios/register'>
) {
  const {
    components: { appAttest, attestationState, logs },
    request
  } = context
  const logger = logs.getLogger('attest-ios-register')

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

  const challengeBytes = attestationState.consumeChallenge(challenge)
  if (!challengeBytes) {
    return { status: 400, body: { error: 'challenge unknown or expired' } }
  }

  try {
    const { publicKeyPem } = appAttest.verifyRegistration({
      keyIdB64u: key_id,
      attestationObjectB64u: attestation_object,
      challengeBytes
    })
    attestationState.registerKey(key_id, publicKeyPem)
    logger.info('ios key registered', { key_id_prefix: key_id.slice(0, 8) })
    return { status: 200, body: { registered: true } }
  } catch (e: any) {
    const msg = e instanceof AppAttestError ? e.message : `unexpected: ${e?.message || e}`
    logger.warn('ios key registration failed', { key_id_prefix: key_id.slice(0, 8), error: msg })
    return { status: 400, body: { error: msg } }
  }
}
