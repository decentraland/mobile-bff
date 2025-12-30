import { Authenticator } from '@dcl/crypto'
import { test } from '../components'
import { getAuthHeaders, getIdentity, Identity } from '../utils/signed-fetch'
import { createTestSceneGroup } from '../mocks/scene-groups-db-mock'

describe('scene-groups controller integration tests', () => {
  test('public scene-groups endpoints', function ({ components }) {
    describe('GET /scene-groups', () => {
      it('should return 200 with empty array when no groups exist', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/scene-groups')
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.ok).toBe(true)
        expect(body.data).toEqual([])
      })

      it('should return scene groups when they exist', async () => {
        const mockGroup = createTestSceneGroup()
        ;(components.sceneGroupsDb as any)._setGetAllSceneGroupsResult([mockGroup])

        const { localFetch } = components
        const response = await localFetch.fetch('/scene-groups')
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.ok).toBe(true)
        expect(body.data).toHaveLength(1)
        expect(body.data[0].name).toBe(mockGroup.name)

        // Clean up
        ;(components.sceneGroupsDb as any)._setGetAllSceneGroupsResult([])
      })

      it('should filter by parcel when parcel param is provided', async () => {
        const mockGroup = createTestSceneGroup({ name: 'Found Group' })
        ;(components.sceneGroupsDb as any)._setGetSceneGroupByParcelResult(mockGroup)

        const { localFetch } = components
        const response = await localFetch.fetch('/scene-groups?parcel=0,0')
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.ok).toBe(true)
        expect(body.data.name).toBe('Found Group')

        // Clean up
        ;(components.sceneGroupsDb as any)._setGetSceneGroupByParcelResult(null)
      })

      it('should return null when parcel not in any group', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/scene-groups?parcel=999,999')
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.ok).toBe(true)
        expect(body.data).toBeNull()
      })

      it('should return 400 for invalid parcel format', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/scene-groups?parcel=abc,0')
        const body = await response.json()

        expect(response.status).toBe(400)
        expect(body.ok).toBe(false)
      })

      it('should return 400 for malformed parcel param', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/scene-groups?parcel=0')
        const body = await response.json()

        expect(response.status).toBe(400)
        expect(body.ok).toBe(false)
      })
    })

    describe('GET /scene-groups/:id', () => {
      it('should return 404 when group does not exist', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/scene-groups/00000000-0000-0000-0000-000000000000')
        const body = await response.json()

        expect(response.status).toBe(404)
        expect(body.ok).toBe(false)
        expect(body.error).toBe('Scene group not found')
      })

      it('should return the group when it exists', async () => {
        const mockGroup = createTestSceneGroup({ id: 'test-id-123' })
        ;(components.sceneGroupsDb as any)._setGetSceneGroupByIdResult(mockGroup)

        const { localFetch } = components
        const response = await localFetch.fetch('/scene-groups/test-id-123')
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.ok).toBe(true)
        expect(body.data.id).toBe('test-id-123')

        // Clean up
        ;(components.sceneGroupsDb as any)._setGetSceneGroupByIdResult(null)
      })
    })
  })

  test('backoffice scene-groups endpoints with signed fetch', function ({ components }) {
    let identity: Identity
    const ALLOWED_ADDRESS = '0x1234567890123456789012345678901234567890'

    beforeEach(async () => {
      identity = await getIdentity()
      // Set the allowed users to include our test identity
      ;(components.config as any)._setConfigValue('ALLOWED_USERS', identity.realAccount.address)
    })

    afterEach(() => {
      ;(components.config as any)._clearConfigOverrides()
    })

    function makeSignedRequest(method: string, path: string, body?: any) {
      const { localFetch } = components
      const headers: Record<string, string> = {
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
      if (body) {
        headers['Content-Type'] = 'application/json'
      }
      return localFetch.fetch(path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
      })
    }

    describe('GET /backoffice/scene-groups', () => {
      it('should return 400 when not signed', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/backoffice/scene-groups')
        expect(response.status).toBe(400)
      })

      it('should return 200 with scene groups when signed by allowed user', async () => {
        const response = await makeSignedRequest('GET', '/backoffice/scene-groups')
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.ok).toBe(true)
      })

      it('should return 403 when user is not in allowed list', async () => {
        ;(components.config as any)._setConfigValue('ALLOWED_USERS', '0xOTHER_ADDRESS')

        const response = await makeSignedRequest('GET', '/backoffice/scene-groups')
        const body = await response.json()

        expect(response.status).toBe(403)
        expect(body.error).toContain('Forbidden')
      })
    })

    describe('POST /backoffice/scene-groups', () => {
      it('should return 400 when not signed', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/backoffice/scene-groups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Test', color: '#FF0000', parcels: [] })
        })
        expect(response.status).toBe(400)
      })

      it('should return 201 when creating a valid scene group', async () => {
        const response = await makeSignedRequest('POST', '/backoffice/scene-groups', {
          name: 'New Group',
          color: '#FF6B6B',
          parcels: [{ x: 0, y: 0 }]
        })
        const body = await response.json()

        expect(response.status).toBe(201)
        expect(body.ok).toBe(true)
        expect(body.data.name).toBe('New Group')
      })

      it('should return 400 for invalid color format', async () => {
        const response = await makeSignedRequest('POST', '/backoffice/scene-groups', {
          name: 'Bad Color',
          color: 'red',
          parcels: []
        })
        const body = await response.json()

        expect(response.status).toBe(400)
        expect(body.error).toContain('color format')
      })

      it('should return 400 for missing required fields', async () => {
        const response = await makeSignedRequest('POST', '/backoffice/scene-groups', {
          name: 'No Color'
        })
        const body = await response.json()

        expect(response.status).toBe(400)
      })
    })

    describe('PUT /backoffice/scene-groups/:id', () => {
      it('should return 404 when group does not exist', async () => {
        const response = await makeSignedRequest('PUT', '/backoffice/scene-groups/00000000-0000-0000-0000-000000000000', {
          name: 'Updated Name'
        })
        const body = await response.json()

        expect(response.status).toBe(404)
        expect(body.error).toBe('Scene group not found')
      })

      it('should return 200 when updating a group', async () => {
        const mockGroup = createTestSceneGroup({ id: 'update-id', name: 'Updated Name' })
        ;(components.sceneGroupsDb as any)._setUpdateSceneGroupResult(mockGroup)

        const response = await makeSignedRequest('PUT', '/backoffice/scene-groups/update-id', {
          name: 'Updated Name'
        })
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.ok).toBe(true)
        expect(body.data.name).toBe('Updated Name')

        // Clean up
        ;(components.sceneGroupsDb as any)._setUpdateSceneGroupResult(null)
      })
    })

    describe('DELETE /backoffice/scene-groups/:id', () => {
      it('should return 404 when group does not exist', async () => {
        const response = await makeSignedRequest('DELETE', '/backoffice/scene-groups/00000000-0000-0000-0000-000000000000')
        const body = await response.json()

        expect(response.status).toBe(404)
        expect(body.error).toBe('Scene group not found')
      })

      it('should return 200 when deleting a group', async () => {
        ;(components.sceneGroupsDb as any)._setDeleteSceneGroupResult(true)

        const response = await makeSignedRequest('DELETE', '/backoffice/scene-groups/delete-id')
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.ok).toBe(true)
        expect(body.data.id).toBe('delete-id')

        // Clean up
        ;(components.sceneGroupsDb as any)._setDeleteSceneGroupResult(false)
      })
    })
  })
})
