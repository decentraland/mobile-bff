import { HandlerContextWithPath } from '../../../types'

// POST /attest/ios/challenge — issue a random one-shot challenge that the
// client uses as part of the App Attest enrollment ceremony.
export async function attestIosChallengeHandler(
  context: HandlerContextWithPath<'attestationState', '/attest/ios/challenge'>
) {
  const {
    components: { attestationState }
  } = context
  const { challenge, expiresAt } = await attestationState.issueChallenge()
  return { status: 200, body: { challenge, expires_at: expiresAt } }
}
