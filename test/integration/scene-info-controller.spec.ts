import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import { createMetricsComponent } from '@well-known-components/metrics'
import { createPgComponent, IPgComponent } from '@well-known-components/pg-component'
import { metricDeclarations } from '../../src/metrics'
import { createBansDbComponent, IBansDbComponent } from '../../src/adapters/bans-db'
import { createSceneGroupsDbComponent, ISceneGroupsDbComponent } from '../../src/adapters/scene-groups-db'
import { getSceneInfoHandler } from '../../src/controllers/handlers/scene-groups/get-scene-info-handler'
import { ILoggerComponent } from '@well-known-components/interfaces'

// These tests require a real PostgreSQL database
const runDbTests = process.env.CI === 'true' || process.env.RUN_DB_TESTS === 'true'

;(runDbTests ? describe : describe.skip)('scene-info controller integration tests', () => {
  let pg: IPgComponent
  let bansDb: IBansDbComponent
  let sceneGroupsDb: ISceneGroupsDbComponent
  let logs: ILoggerComponent

  beforeAll(async () => {
    process.env.PG_COMPONENT_PSQL_DATABASE = 'mobile_test'

    const config = await createDotEnvConfigComponent({ path: ['.env.default', '.env'] })
    const metrics = await createMetricsComponent(metricDeclarations, { config })
    logs = await createLogComponent({ metrics })

    pg = await createPgComponent({ logs, config, metrics }, {
      migration: {
        databaseUrl: await getDbConnectionString(config),
        dir: __dirname + '/../../dist/migrations',
        migrationsTable: 'pgmigrations',
        ignorePattern: '.*\\.map',
        direction: 'up'
      }
    })

    await pg.start()

    bansDb = await createBansDbComponent({ pg })
    sceneGroupsDb = await createSceneGroupsDbComponent({ pg })
  })

  afterAll(async () => {
    if (pg) {
      await pg.stop()
    }
  })

  beforeEach(async () => {
    // Clean up tables (order matters due to FK constraints)
    await pg.query('DELETE FROM ban_parcels')
    await pg.query('DELETE FROM bans')
    await pg.query('DELETE FROM scene_group_parcels')
    await pg.query('DELETE FROM scene_groups')
  })

  async function getDbConnectionString(config: any): Promise<string> {
    let databaseUrl: string | undefined = await config.getString('PG_COMPONENT_PSQL_CONNECTION_STRING')
    if (!databaseUrl) {
      const dbUser = await config.requireString('PG_COMPONENT_PSQL_USER')
      const dbDatabaseName = await config.requireString('PG_COMPONENT_PSQL_DATABASE')
      const dbPort = await config.requireString('PG_COMPONENT_PSQL_PORT')
      const dbHost = await config.requireString('PG_COMPONENT_PSQL_HOST')
      const dbPassword = await config.requireString('PG_COMPONENT_PSQL_PASSWORD')
      databaseUrl = `postgres://${dbUser}:${dbPassword}@${dbHost}:${dbPort}/${dbDatabaseName}`
    }
    return databaseUrl
  }

  function createContext(queryString: string) {
    return {
      components: { sceneGroupsDb, bansDb, logs },
      url: new URL(`http://localhost/scene-info${queryString}`)
    }
  }

  describe('GET /scene-info', () => {
    describe('for parcels belonging to a scene group', () => {
      it('should return the group with isBanned=false when not banned', async () => {
        // Create a scene group
        const group = await sceneGroupsDb.createSceneGroup({
          name: 'Test Group',
          color: '#FF0000',
          parcels: [{ x: 10, y: 20 }, { x: 11, y: 20 }]
        })

        const context = createContext('?parcel=10,20')
        const response = await getSceneInfoHandler(context as any)

        expect(response.status).toBe(200)
        expect(response.body.ok).toBe(true)
        expect(response.body.data.type).toBe('group')
        expect(response.body.data.group.id).toBe(group.id)
        expect(response.body.data.group.name).toBe('Test Group')
        expect(response.body.data.isBanned).toBe(false)
      })

      it('should return the group with isBanned=true when group is banned', async () => {
        // Create and ban a scene group
        const group = await sceneGroupsDb.createSceneGroup({
          name: 'Banned Group',
          color: '#FF0000',
          parcels: [{ x: 30, y: 40 }, { x: 31, y: 40 }]
        })
        await bansDb.createGroupBan({ groupId: group.id, reason: 'Test ban' }, '0x1234')

        const context = createContext('?parcel=30,40')
        const response = await getSceneInfoHandler(context as any)

        expect(response.status).toBe(200)
        expect(response.body.data.type).toBe('group')
        expect(response.body.data.group.id).toBe(group.id)
        expect(response.body.data.isBanned).toBe(true)
      })

      it('should return the full group even when querying one parcel', async () => {
        const group = await sceneGroupsDb.createSceneGroup({
          name: 'Multi-Parcel Group',
          color: '#00FF00',
          parcels: [{ x: 50, y: 60 }, { x: 51, y: 60 }, { x: 52, y: 60 }]
        })

        // Query with just one parcel
        const context = createContext('?parcel=51,60')
        const response = await getSceneInfoHandler(context as any)

        expect(response.status).toBe(200)
        expect(response.body.data.type).toBe('group')
        expect(response.body.data.group.parcels).toHaveLength(3)
      })
    })

    describe('for isolated scenes (no group)', () => {
      it('should return scene info with isBanned=false when not banned', async () => {
        const context = createContext('?parcel=100,200')
        const response = await getSceneInfoHandler(context as any)

        expect(response.status).toBe(200)
        expect(response.body.ok).toBe(true)
        expect(response.body.data.type).toBe('scene')
        expect(response.body.data.parcel).toEqual({ x: 100, y: 200 })
        expect(response.body.data.isBanned).toBe(false)
      })

      it('should return scene info with isBanned=true when scene is banned', async () => {
        // Ban the scene first (single parcel)
        const parcels = [{ x: 150, y: 250 }]
        await bansDb.createSceneBan({ parcels, reason: 'Inappropriate content' }, '0x5678')

        const context = createContext('?parcel=150,250')
        const response = await getSceneInfoHandler(context as any)

        expect(response.status).toBe(200)
        expect(response.body.data.type).toBe('scene')
        expect(response.body.data.isBanned).toBe(true)
      })

      it('should handle negative coordinates', async () => {
        await bansDb.createSceneBan({
          parcels: [{ x: -50, y: -60 }],
          reason: 'Banned negative coords'
        }, '0xDEF')

        const context = createContext('?parcel=-50,-60')
        const response = await getSceneInfoHandler(context as any)

        expect(response.status).toBe(200)
        expect(response.body.data.type).toBe('scene')
        expect(response.body.data.isBanned).toBe(true)
      })
    })

    describe('validation errors', () => {
      it('should return 400 when parcel parameter is missing', async () => {
        const context = createContext('')
        const response = await getSceneInfoHandler(context as any)

        expect(response.status).toBe(400)
        expect(response.body.error).toContain('Missing parcel')
      })

      it('should return 400 for invalid parcel format', async () => {
        const context = createContext('?parcel=invalid')
        const response = await getSceneInfoHandler(context as any)

        expect(response.status).toBe(400)
        expect(response.body.error).toContain('Invalid parcel format')
      })
    })

    describe('banning and unbanning flows', () => {
      it('should reflect ban status changes for groups', async () => {
        const group = await sceneGroupsDb.createSceneGroup({
          name: 'Toggle Ban Group',
          color: '#0000FF',
          parcels: [{ x: 300, y: 400 }]
        })

        // Initially not banned
        let context = createContext('?parcel=300,400')
        let response = await getSceneInfoHandler(context as any)
        expect(response.body.data.isBanned).toBe(false)

        // Ban the group
        const ban = await bansDb.createGroupBan({ groupId: group.id }, '0x123')

        // Now should be banned
        context = createContext('?parcel=300,400')
        response = await getSceneInfoHandler(context as any)
        expect(response.body.data.isBanned).toBe(true)

        // Unban the group
        await bansDb.deleteBan(ban.id)

        // Should be unbanned again
        context = createContext('?parcel=300,400')
        response = await getSceneInfoHandler(context as any)
        expect(response.body.data.isBanned).toBe(false)
      })

      it('should reflect ban status changes for scenes', async () => {
        const parcels = [{ x: 500, y: 600 }]

        // Initially not banned
        let context = createContext('?parcel=500,600')
        let response = await getSceneInfoHandler(context as any)
        expect(response.body.data.isBanned).toBe(false)

        // Ban the scene
        const ban = await bansDb.createSceneBan({ parcels }, '0x456')

        // Now should be banned
        context = createContext('?parcel=500,600')
        response = await getSceneInfoHandler(context as any)
        expect(response.body.data.isBanned).toBe(true)

        // Unban the scene
        await bansDb.deleteBan(ban.id)

        // Should be unbanned again
        context = createContext('?parcel=500,600')
        response = await getSceneInfoHandler(context as any)
        expect(response.body.data.isBanned).toBe(false)
      })
    })
  })
})
