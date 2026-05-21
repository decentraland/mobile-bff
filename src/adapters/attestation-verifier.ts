// Shared platform-attestation verifier — drives POST /attest/session.
//
// iOS: each session-issuance request carries a fresh App Attest attestation
// (the client generates a new key per session, ~200ms in Secure Enclave).
// We verify the attestation against a server-issued challenge and return
// the leaf public key only as a side-effect of validation — nothing is
// persisted, the session token issued by the caller is the durable
// credential.
//
// Android: stateless from the start — Play Integrity tokens are verified
// against Google and bound to SHA256(rawBody) via requestHash.

import { AppComponents } from '../types'
import { AppAttestError } from './app-attest'
import { PlayIntegrityError } from './play-integrity'

export type AttestationOutcome = {
  ok: boolean
  platform: string
  code: string
  error?: string
  details?: unknown
  verdicts?: string[]
  keyIdPrefix?: string
}

type HeadersLike = { get(name: string): string | null }

// iOS body shape carried inside the raw request body of POST /attest/session.
// Parsed by the verifier so the handler stays platform-agnostic.
type IosAttestBody = {
  key_id?: unknown
  attestation_object?: unknown
  challenge?: unknown
}

export type IAttestationVerifierComponent = {
  verify(input: { headers: HeadersLike; rawBody: Buffer }): Promise<AttestationOutcome>
}

export async function createAttestationVerifierComponent({
  appAttest,
  playIntegrity,
  logs,
  metrics
}: Pick<AppComponents, 'appAttest' | 'playIntegrity' | 'logs' | 'metrics'>): Promise<IAttestationVerifierComponent> {
  const logger = logs.getLogger('attestation-verifier')

  function record(outcome: AttestationOutcome, startMs: number): AttestationOutcome {
    const labels = { platform: outcome.platform, code: outcome.code }
    metrics.increment('attestation_verify_total', labels)
    metrics.observe('attestation_verify_duration_seconds', labels, (Date.now() - startMs) / 1000)
    return outcome
  }

  async function verify({
    headers,
    rawBody
  }: {
    headers: HeadersLike
    rawBody: Buffer
  }): Promise<AttestationOutcome> {
    const startMs = Date.now()
    const out = await verifyInternal({ headers, rawBody })
    return record(out, startMs)
  }

  async function verifyInternal({
    headers,
    rawBody
  }: {
    headers: HeadersLike
    rawBody: Buffer
  }): Promise<AttestationOutcome> {
    const platformRaw = headers.get('x-attest-platform')

    if (!platformRaw) {
      return { ok: false, platform: 'unknown', code: 'ATTESTATION_MISSING', error: 'missing x-attest-platform header' }
    }

    if (platformRaw === 'ios') {
      let parsed: IosAttestBody
      try {
        parsed = JSON.parse(rawBody.toString('utf8'))
      } catch (e: any) {
        return {
          ok: false,
          platform: 'ios',
          code: 'ATTESTATION_IOS_BAD_BODY',
          error: `request body is not valid JSON: ${e?.message || e}`
        }
      }
      const { key_id, attestation_object, challenge } = parsed
      if (typeof key_id !== 'string' || typeof attestation_object !== 'string' || typeof challenge !== 'string') {
        return {
          ok: false,
          platform: 'ios',
          code: 'ATTESTATION_IOS_BAD_BODY',
          error: 'key_id, attestation_object, challenge are required strings'
        }
      }
      const keyIdPrefix = key_id.slice(0, 8)
      const challengeBytes = appAttest.verifyChallenge(challenge)
      if (!challengeBytes) {
        return {
          ok: false,
          platform: 'ios',
          code: 'ATTESTATION_IOS_BAD_CHALLENGE',
          error: 'challenge is invalid, tampered, or expired — request a fresh one from /attest/ios/challenge',
          keyIdPrefix
        }
      }
      try {
        appAttest.verifyRegistration({
          keyIdB64u: key_id,
          attestationObjectB64u: attestation_object,
          challengeBytes
        })
        logger.info('ios attest ok', { key_id_prefix: keyIdPrefix })
        return { ok: true, platform: 'ios', code: 'OK', keyIdPrefix }
      } catch (e: any) {
        const code = e instanceof AppAttestError ? e.code : 'ATTESTATION_IOS_BAD_ASSERTION'
        const error: string = e?.message || String(e)
        logger.warn('ios attest failed', { key_id_prefix: keyIdPrefix, code, error })
        return { ok: false, platform: 'ios', code, error, keyIdPrefix }
      }
    }

    if (platformRaw === 'android') {
      const integrityToken = headers.get('x-attest-integrity-token')
      if (!integrityToken) {
        return {
          ok: false,
          platform: 'android',
          code: 'ATTESTATION_ANDROID_INVALID_TOKEN',
          error: 'x-attest-integrity-token header required'
        }
      }
      try {
        const { payload } = await playIntegrity.verifyIntegrityToken({ integrityToken, rawBody })
        const verdicts = payload.deviceIntegrity?.deviceRecognitionVerdict ?? []
        logger.info('android attest ok', { verdicts: verdicts.join(',') })
        return { ok: true, platform: 'android', code: 'OK', verdicts }
      } catch (e: any) {
        if (e instanceof PlayIntegrityError) {
          logger.warn('android attest failed', { code: e.code, error: e.message })
          return { ok: false, platform: 'android', code: e.code, error: e.message, details: e.extra }
        }
        const error: string = e?.message || String(e)
        logger.warn('android attest unexpected error', { error })
        return { ok: false, platform: 'android', code: 'ATTESTATION_ANDROID_INVALID_TOKEN', error: `unexpected: ${error}` }
      }
    }

    return {
      ok: false,
      platform: platformRaw,
      code: 'ATTESTATION_UNKNOWN_PLATFORM',
      error: `x-attest-platform must be 'ios' or 'android', got '${platformRaw}'`
    }
  }

  return { verify }
}
