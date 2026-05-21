// Shared platform-attestation verifier — used by both /v1/attest/check (which
// always returns 200 with the verdict in the body) and the /v1/wallets/sign-message
// gate (which returns 401 on a failed verdict).
//
// Outcome shape mirrors the response body of /v1/attest/check so analytics
// downstream can parse the same fields whether they come from the report
// endpoint or from a sign-message failure.

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

export type IAttestationVerifierComponent = {
  verify(input: { headers: HeadersLike; rawBody: Buffer }): Promise<AttestationOutcome>
}

export async function createAttestationVerifierComponent({
  appAttest,
  playIntegrity,
  attestationState,
  logs
}: Pick<AppComponents, 'appAttest' | 'playIntegrity' | 'attestationState' | 'logs'>): Promise<IAttestationVerifierComponent> {
  const logger = logs.getLogger('attestation-verifier')

  async function verify({
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
      const keyIdB64u = headers.get('x-attest-key-id')
      const assertionB64u = headers.get('x-attest-assertion')
      const nonceB64u = headers.get('x-attest-nonce')
      if (!keyIdB64u || !assertionB64u || !nonceB64u) {
        return {
          ok: false,
          platform: 'ios',
          code: 'ATTESTATION_IOS_BAD_ASSERTION',
          error: 'x-attest-key-id, x-attest-assertion, x-attest-nonce all required'
        }
      }
      const stored = attestationState.getRegisteredKey(keyIdB64u)
      if (!stored) {
        return {
          ok: false,
          platform: 'ios',
          code: 'ATTESTATION_IOS_KEY_NOT_REGISTERED',
          error: 'key_id has not completed registration — call /v1/attest/ios/register first'
        }
      }
      let nonceBytes: Buffer
      try {
        nonceBytes = Buffer.from(nonceB64u, 'base64url')
      } catch {
        return {
          ok: false,
          platform: 'ios',
          code: 'ATTESTATION_IOS_BAD_ASSERTION',
          error: 'x-attest-nonce is not base64url'
        }
      }
      try {
        const { newCounter } = appAttest.verifyAssertion({
          assertionB64u,
          nonceBytes,
          rawBody,
          storedPublicKeyPem: stored.publicKeyPem,
          storedCounter: stored.counter
        })
        attestationState.updateKeyCounter(keyIdB64u, newCounter)
        const keyIdPrefix = keyIdB64u.slice(0, 8)
        logger.info('ios attest ok', { key_id_prefix: keyIdPrefix })
        return { ok: true, platform: 'ios', code: 'OK', keyIdPrefix }
      } catch (e: any) {
        const isReplay = e instanceof AppAttestError && /counter replay/.test(e.message)
        const code = isReplay ? 'ATTESTATION_IOS_COUNTER_REPLAY' : 'ATTESTATION_IOS_BAD_ASSERTION'
        const error: string = e?.message || String(e)
        logger.warn('ios attest failed', { key_id_prefix: keyIdB64u.slice(0, 8), code, error })
        return { ok: false, platform: 'ios', code, error }
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
