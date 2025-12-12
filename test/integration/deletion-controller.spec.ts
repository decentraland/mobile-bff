import { Authenticator } from '@dcl/crypto'
import { test } from '../components'
import { getAuthHeaders, getIdentity, Identity } from '../utils/signed-fetch'
import { createTestDeletionRequest } from '../mocks/db-mock'

describe('deletion controller integration tests', () => {
  test('deletion endpoints with signed fetch', function ({ components }) {
    let identity: Identity

    beforeEach(async () => {
      identity = await getIdentity()
    })

    function makeRequest(method: string, path: string) {
      const { localFetch } = components
      return localFetch.fetch(path, {
        method,
        headers: {
          ...getAuthHeaders(method, path, { origin: 'https://play.decentraland.org' }, (payload) =>
            Authenticator.signPayload(
              {
                ephemeralIdentity: identity.ephemeralIdentity,
                expiration: new Date(Date.now() + 60 * 1000),
                authChain: identity.authChain.authChain
              },
              payload
            )
          )
        }
      })
    }

    describe('POST /deletion - Request account deletion', () => {
      describe('when the request is properly signed', () => {
        it('should return 201 and create a deletion request', async () => {
          const response = await makeRequest('POST', '/deletion')
          const body = await response.json()

          expect(response.status).toBe(201)
          expect(body.ok).toBe(true)
          expect(body.data.status).toBe('pending')
        })
      })

      describe('when the request is not signed', () => {
        it('should return an error requiring signed fetch', async () => {
          const { localFetch } = components
          const response = await localFetch.fetch('/deletion', { method: 'POST' })
          const body = await response.json()

          expect(response.status).toBe(400)
          expect(body.message).toContain('signed fetch')
        })
      })
    })

    describe('GET /deletion - Check deletion status', () => {
      describe('when the user has no deletion request', () => {
        it('should return 200 with null data', async () => {
          const response = await makeRequest('GET', '/deletion')
          const body = await response.json()

          expect(response.status).toBe(200)
          expect(body.ok).toBe(true)
          expect(body.data).toBeNull()
        })
      })

      describe('when the user has a pending deletion request', () => {
        beforeEach(() => {
          const mockRequest = createTestDeletionRequest({
            userAddress: identity.realAccount.address.toLowerCase(),
            status: 'pending'
          })
          ;(components.db as any)._setGetDeletionRequestResult(mockRequest)
        })

        afterEach(() => {
          ;(components.db as any)._setGetDeletionRequestResult(null)
        })

        it('should return 200 with the deletion request', async () => {
          const response = await makeRequest('GET', '/deletion')
          const body = await response.json()

          expect(response.status).toBe(200)
          expect(body.ok).toBe(true)
          expect(body.data.status).toBe('pending')
        })
      })

      describe('when the request is not signed', () => {
        it('should return an error requiring signed fetch', async () => {
          const { localFetch } = components
          const response = await localFetch.fetch('/deletion', { method: 'GET' })
          const body = await response.json()

          expect(response.status).toBe(400)
          expect(body.message).toContain('signed fetch')
        })
      })
    })

    describe('DELETE /deletion - Cancel deletion request', () => {
      describe('when the user has a pending deletion request', () => {
        beforeEach(() => {
          const mockCancelledRequest = createTestDeletionRequest({
            userAddress: identity.realAccount.address.toLowerCase(),
            status: 'cancelled',
            cancelledAt: new Date()
          })
          ;(components.db as any)._setCancelDeletionRequestResult(mockCancelledRequest)
        })

        afterEach(() => {
          ;(components.db as any)._setCancelDeletionRequestResult(null)
        })

        it('should return 200 and cancel the request', async () => {
          const response = await makeRequest('DELETE', '/deletion')
          const body = await response.json()

          expect(response.status).toBe(200)
          expect(body.ok).toBe(true)
          expect(body.data.status).toBe('cancelled')
        })
      })

      describe('when the user has no pending deletion request', () => {
        it('should return 404 Not Found', async () => {
          const response = await makeRequest('DELETE', '/deletion')
          const body = await response.json()

          expect(response.status).toBe(404)
          expect(body.ok).toBe(false)
          expect(body.error).toBe('No pending deletion request found')
        })
      })

      describe('when the request is not signed', () => {
        it('should return an error requiring signed fetch', async () => {
          const { localFetch } = components
          const response = await localFetch.fetch('/deletion', { method: 'DELETE' })
          const body = await response.json()

          expect(response.status).toBe(400)
          expect(body.message).toContain('signed fetch')
        })
      })
    })
  })
})
