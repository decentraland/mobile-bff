import { Authenticator } from '@dcl/crypto'
import { test } from '../components'
import { getAuthHeaders, getIdentity, Identity } from '../utils/signed-fetch'

describe('bans controller integration tests', () => {
  test('public bans endpoint', function ({ components }) {
    beforeEach(async () => {
      // Clean up database before each test (order matters due to FK constraints)
      await components.pg.query('DELETE FROM ban_parcels')
      await components.pg.query('DELETE FROM bans')
      await components.pg.query('DELETE FROM scene_group_parcels')
      await components.pg.query('DELETE FROM scene_groups')
    })

    describe('GET /bans', () => {
      it('should return 200 with empty array when no bans exist', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/bans')
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.ok).toBe(true)
        expect(body.data).toEqual([])
      })

      it('should return scene bans', async () => {
        // Create a scene ban directly in the database
        await components.bansDb.createSceneBan(
          { parcels: [{ x: 10, y: 20 }, { x: 11, y: 20 }], reason: 'Inappropriate content' },
          '0x1234567890123456789012345678901234567890'
        )

        const { localFetch } = components
        const response = await localFetch.fetch('/bans')
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.ok).toBe(true)
        expect(body.data).toHaveLength(1)
        expect(body.data[0].parcels).toHaveLength(2)
        expect(body.data[0].parcels).toContainEqual({ x: 10, y: 20 })
        expect(body.data[0].parcels).toContainEqual({ x: 11, y: 20 })
        expect(body.data[0].reason).toBe('Inappropriate content')
        expect(body.data[0].groupId).toBeNull()
        expect(body.data[0].worldName).toBeNull()
      })

      it('should return group bans', async () => {
        // First create a scene group
        const group = await components.sceneGroupsDb.createSceneGroup({
          name: 'Test Group',
          color: '#FF0000',
          parcels: [{ x: 50, y: 50 }]
        })

        // Then ban the group
        await components.bansDb.createGroupBan(
          { groupId: group.id, reason: 'Group violation' },
          '0xABCDEF1234567890123456789012345678901234'
        )

        const { localFetch } = components
        const response = await localFetch.fetch('/bans')
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.ok).toBe(true)
        expect(body.data).toHaveLength(1)
        expect(body.data[0].groupId).toBe(group.id)
        expect(body.data[0].reason).toBe('Group violation')
        expect(body.data[0].parcels).toEqual([])
      })

      it('should return world bans', async () => {
        await components.bansDb.createWorldBan(
          { worldName: 'bad-world.dcl.eth', reason: 'World policy violation' },
          '0x1234567890123456789012345678901234567890'
        )

        const { localFetch } = components
        const response = await localFetch.fetch('/bans')
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.ok).toBe(true)
        expect(body.data).toHaveLength(1)
        expect(body.data[0].worldName).toBe('bad-world.dcl.eth')
        expect(body.data[0].reason).toBe('World policy violation')
        expect(body.data[0].groupId).toBeNull()
        expect(body.data[0].parcels).toEqual([])
      })

      it('should return all types of bans together', async () => {
        // Create a scene group for group ban
        const group = await components.sceneGroupsDb.createSceneGroup({
          name: 'Mixed Test Group',
          color: '#00FF00',
          parcels: [{ x: 100, y: 100 }]
        })

        // Create all three types of bans
        await components.bansDb.createSceneBan(
          { parcels: [{ x: 0, y: 0 }], reason: 'Scene ban' },
          '0x1111111111111111111111111111111111111111'
        )
        await components.bansDb.createGroupBan(
          { groupId: group.id, reason: 'Group ban' },
          '0x2222222222222222222222222222222222222222'
        )
        await components.bansDb.createWorldBan(
          { worldName: 'test-world.dcl.eth', reason: 'World ban' },
          '0x3333333333333333333333333333333333333333'
        )

        const { localFetch } = components
        const response = await localFetch.fetch('/bans')
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.ok).toBe(true)
        expect(body.data).toHaveLength(3)

        // Check we have all three types
        const sceneBan = body.data.find((b: any) => b.groupId === null && b.worldName === null)
        const groupBan = body.data.find((b: any) => b.groupId !== null)
        const worldBan = body.data.find((b: any) => b.worldName !== null)

        expect(sceneBan).toBeDefined()
        expect(sceneBan.parcels).toEqual([{ x: 0, y: 0 }])

        expect(groupBan).toBeDefined()
        expect(groupBan.groupId).toBe(group.id)

        expect(worldBan).toBeDefined()
        expect(worldBan.worldName).toBe('test-world.dcl.eth')
      })

      it('should include sceneId when present', async () => {
        await components.bansDb.createSceneBan(
          { parcels: [{ x: 5, y: 5 }], sceneId: 'bafkreiabcdef123456789', reason: 'With scene ID' },
          '0x1234567890123456789012345678901234567890'
        )

        const { localFetch } = components
        const response = await localFetch.fetch('/bans')
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.data[0].sceneId).toBe('bafkreiabcdef123456789')
      })

      it('should include createdAt and createdBy', async () => {
        const createdBy = '0xABCDEF1234567890123456789012345678901234'
        await components.bansDb.createSceneBan(
          { parcels: [{ x: 1, y: 1 }] },
          createdBy
        )

        const { localFetch } = components
        const response = await localFetch.fetch('/bans')
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.data[0].createdBy).toBe(createdBy)
        expect(typeof body.data[0].createdAt).toBe('number')
        expect(body.data[0].createdAt).toBeGreaterThan(0)
      })

      it('should return bans ordered by createdAt descending', async () => {
        // Create bans with slight delay to ensure different timestamps
        await components.bansDb.createSceneBan(
          { parcels: [{ x: 1, y: 1 }], reason: 'First' },
          '0x1234567890123456789012345678901234567890'
        )
        await components.bansDb.createSceneBan(
          { parcels: [{ x: 2, y: 2 }], reason: 'Second' },
          '0x1234567890123456789012345678901234567890'
        )
        await components.bansDb.createSceneBan(
          { parcels: [{ x: 3, y: 3 }], reason: 'Third' },
          '0x1234567890123456789012345678901234567890'
        )

        const { localFetch } = components
        const response = await localFetch.fetch('/bans')
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.data).toHaveLength(3)
        // Most recent first
        expect(body.data[0].reason).toBe('Third')
        expect(body.data[1].reason).toBe('Second')
        expect(body.data[2].reason).toBe('First')
      })

      it('should not require authentication', async () => {
        // This test verifies the endpoint is public - no signed fetch needed
        const { localFetch } = components
        const response = await localFetch.fetch('/bans', {
          method: 'GET',
          headers: {} // No auth headers
        })

        expect(response.status).toBe(200)
      })
    })
  })

  test('backoffice bans endpoints with signed fetch', function ({ components }) {
    let identity: Identity

    beforeAll(async () => {
      identity = await getIdentity()
      process.env.ALLOWED_USERS = identity.realAccount.address
    })

    beforeEach(async () => {
      // Clean up database before each test
      await components.pg.query('DELETE FROM ban_parcels')
      await components.pg.query('DELETE FROM bans')
      await components.pg.query('DELETE FROM scene_group_parcels')
      await components.pg.query('DELETE FROM scene_groups')
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

    describe('GET /backoffice/bans', () => {
      it('should return 400 when not signed', async () => {
        const { localFetch } = components
        const response = await localFetch.fetch('/backoffice/bans')
        expect(response.status).toBe(401)
      })

      it('should return 200 with bans when signed by allowed user', async () => {
        await components.bansDb.createSceneBan(
          { parcels: [{ x: 0, y: 0 }] },
          '0x1234567890123456789012345678901234567890'
        )

        const response = await makeSignedRequest('GET', '/backoffice/bans')
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.ok).toBe(true)
        expect(body.data).toHaveLength(1)
      })

      it('should return 403 when user is not in allowed list', async () => {
        process.env.ALLOWED_USERS = '0xOTHER_ADDRESS'

        const response = await makeSignedRequest('GET', '/backoffice/bans')
        const body = await response.json()

        expect(response.status).toBe(403)
        expect(body.error).toContain('Forbidden')

        // Restore
        process.env.ALLOWED_USERS = identity.realAccount.address
      })
    })

    describe('POST /backoffice/bans', () => {
      it('should create a scene ban', async () => {
        const response = await makeSignedRequest('POST', '/backoffice/bans', {
          parcels: [{ x: 10, y: 10 }],
          reason: 'Test scene ban'
        })
        const body = await response.json()

        expect(response.status).toBe(201)
        expect(body.ok).toBe(true)
        expect(body.data.parcels).toEqual([{ x: 10, y: 10 }])
        expect(body.data.reason).toBe('Test scene ban')
      })

      it('should create a group ban', async () => {
        // First create a group
        const group = await components.sceneGroupsDb.createSceneGroup({
          name: 'Ban Test Group',
          color: '#FF0000',
          parcels: [{ x: 20, y: 20 }]
        })

        const response = await makeSignedRequest('POST', '/backoffice/bans', {
          groupId: group.id,
          reason: 'Test group ban'
        })
        const body = await response.json()

        expect(response.status).toBe(201)
        expect(body.ok).toBe(true)
        expect(body.data.groupId).toBe(group.id)
      })

      it('should create a world ban', async () => {
        const response = await makeSignedRequest('POST', '/backoffice/bans', {
          worldName: 'test-world.dcl.eth',
          reason: 'Test world ban'
        })
        const body = await response.json()

        expect(response.status).toBe(201)
        expect(body.ok).toBe(true)
        expect(body.data.worldName).toBe('test-world.dcl.eth')
      })
    })

    describe('DELETE /backoffice/bans/:id', () => {
      it('should delete a ban', async () => {
        const ban = await components.bansDb.createSceneBan(
          { parcels: [{ x: 30, y: 30 }] },
          '0x1234567890123456789012345678901234567890'
        )

        const response = await makeSignedRequest('DELETE', `/backoffice/bans/${ban.id}`)
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.ok).toBe(true)

        // Verify ban is deleted
        const checkResponse = await makeSignedRequest('GET', '/backoffice/bans')
        const checkBody = await checkResponse.json()
        expect(checkBody.data).toHaveLength(0)
      })

      it('should return 404 when ban does not exist', async () => {
        const response = await makeSignedRequest('DELETE', '/backoffice/bans/00000000-0000-0000-0000-000000000000')
        const body = await response.json()

        expect(response.status).toBe(404)
        expect(body.error).toContain('not found')
      })
    })
  })
})
