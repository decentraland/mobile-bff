import { classifyError } from '../../../src/adapters/fcm'

// This is the only piece of the FCM adapter worth testing without a network: everything
// else is one googleapis call. The classification decides whether we pay to retry a send
// and whether a token is struck off future audiences, so getting it wrong is either wasted
// quota or a user who silently stops being reachable.
describe('fcm classifyError', () => {
  // Shape of a real googleapis rejection: the useful code is buried in details[], not in
  // the HTTP status.
  function fcmError(errorCode: string, httpStatus = 400) {
    return {
      code: httpStatus,
      response: {
        status: httpStatus,
        data: {
          error: {
            status: 'INVALID_ARGUMENT',
            details: [
              { '@type': 'type.googleapis.com/google.rpc.BadRequest' },
              { '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode }
            ]
          }
        }
      }
    }
  }

  it('strikes off tokens that will never work again', () => {
    // The app was uninstalled. Retrying is pure waste, and every future audience should
    // skip this token rather than paying for it again.
    expect(classifyError(fcmError('UNREGISTERED', 404))).toEqual({
      errorCode: 'UNREGISTERED',
      retryable: false,
      tokenIsDead: true
    })

    // Registered against a different sender: ours can never deliver to it.
    expect(classifyError(fcmError('SENDER_ID_MISMATCH', 403))).toMatchObject({
      retryable: false,
      tokenIsDead: true
    })
  })

  it('retries what is worth retrying and nothing else', () => {
    expect(classifyError(fcmError('UNAVAILABLE', 503))).toMatchObject({ retryable: true, tokenIsDead: false })
    expect(classifyError(fcmError('QUOTA_EXCEEDED', 429))).toMatchObject({ retryable: true, tokenIsDead: false })

    // A 4xx FCM did not name is our own malformed request; it will fail identically on
    // retry, so burning attempts on it only delays the rest of the campaign.
    expect(classifyError({ code: 400, response: { status: 400, data: {} } })).toMatchObject({
      retryable: false,
      tokenIsDead: false
    })
  })

  it('still decides something useful when FCM names no code', () => {
    // Transport-level failure: no response at all, so there is nothing to read. Retrying a
    // network error is right, and calling the token dead on one would be catastrophic —
    // an outage would empty the audience permanently.
    expect(classifyError(new Error('socket hang up'))).toEqual({
      errorCode: 'UNKNOWN',
      retryable: false,
      tokenIsDead: false
    })

    // A 5xx with no body is still worth another attempt.
    expect(classifyError({ code: 500, response: { status: 500, data: {} } })).toMatchObject({
      errorCode: 'HTTP_500',
      retryable: true,
      tokenIsDead: false
    })
  })
})
