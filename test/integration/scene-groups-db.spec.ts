import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import { createMetricsComponent } from '@well-known-components/metrics'
import { createPgComponent, IPgComponent } from '@well-known-components/pg-component'
import { metricDeclarations } from '../../src/metrics'
import { createSceneGroupsDbComponent, ISceneGroupsDbComponent } from '../../src/adapters/scene-groups-db'

// These tests require a real PostgreSQL database and are designed to run in CI
// Skip locally if PostgreSQL is not available
const runDbTests = process.env.CI === 'true' || process.env.RUN_DB_TESTS === 'true'

;(runDbTests ? describe : describe.skip)('scene-groups-db integration tests', () => {
  let pg: IPgComponent
  let sceneGroupsDb: ISceneGroupsDbComponent

  beforeAll(async () => {
    // Force test database to avoid messing with local dev data
    process.env.PG_COMPONENT_PSQL_DATABASE = 'mobile_test'

    const config = await createDotEnvConfigComponent({ path: ['.env.default', '.env'] })
    const metrics = await createMetricsComponent(metricDeclarations, { config })
    const logs = await createLogComponent({ metrics })

    pg = await createPgComponent({ logs, config, metrics }, {
      migration: {
        databaseUrl: await getDbConnectionString(config),
        dir: __dirname + '/../../dist/migrations',
        migrationsTable: 'pgmigrations',
        ignorePattern: '.*\\.map',
        direction: 'up'
      }
    })

    // Start the pg component to run migrations
    await pg.start()

    sceneGroupsDb = await createSceneGroupsDbComponent({ pg })
  })

  afterAll(async () => {
    if (pg) {
      await pg.stop()
    }
  })

  beforeEach(async () => {
    // Clean up tables before each test
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

  describe('createSceneGroup', () => {
    it('should create a scene group with parcels', async () => {
      const input = {
        name: 'Test Group',
        description: 'A test description',
        color: '#FF6B6B',
        tags: ['test', 'example'],
        parcels: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]
      }

      const result = await sceneGroupsDb.createSceneGroup(input)

      expect(result.id).toBeDefined()
      expect(result.name).toBe('Test Group')
      expect(result.description).toBe('A test description')
      expect(result.color).toBe('#FF6B6B')
      expect(result.tags).toEqual(['test', 'example'])
      expect(result.parcels).toHaveLength(3)
      expect(result.createdAt).toBeDefined()
      expect(result.updatedAt).toBeDefined()
    })

    it('should create a scene group with empty parcels', async () => {
      const input = {
        name: 'Empty Group',
        color: '#00FF00',
        parcels: []
      }

      const result = await sceneGroupsDb.createSceneGroup(input)

      expect(result.name).toBe('Empty Group')
      expect(result.parcels).toEqual([])
    })

    it('should fail when parcel already belongs to another group', async () => {
      await sceneGroupsDb.createSceneGroup({
        name: 'First Group',
        color: '#FF0000',
        parcels: [{ x: 5, y: 5 }]
      })

      await expect(sceneGroupsDb.createSceneGroup({
        name: 'Second Group',
        color: '#00FF00',
        parcels: [{ x: 5, y: 5 }]
      })).rejects.toThrow()
    })
  })

  describe('getAllSceneGroups', () => {
    it('should return empty array when no groups exist', async () => {
      const result = await sceneGroupsDb.getAllSceneGroups()
      expect(result).toEqual([])
    })

    it('should return all scene groups with their parcels', async () => {
      await sceneGroupsDb.createSceneGroup({
        name: 'Group 1',
        color: '#FF0000',
        parcels: [{ x: 0, y: 0 }]
      })
      await sceneGroupsDb.createSceneGroup({
        name: 'Group 2',
        color: '#00FF00',
        parcels: [{ x: 10, y: 10 }, { x: 11, y: 10 }]
      })

      const result = await sceneGroupsDb.getAllSceneGroups()

      expect(result).toHaveLength(2)
      // Ordered by created_at DESC, so Group 2 should be first
      expect(result[0].name).toBe('Group 2')
      expect(result[0].parcels).toHaveLength(2)
      expect(result[1].name).toBe('Group 1')
      expect(result[1].parcels).toHaveLength(1)
    })
  })

  describe('getSceneGroupById', () => {
    it('should return null when group does not exist', async () => {
      const result = await sceneGroupsDb.getSceneGroupById('00000000-0000-0000-0000-000000000000')
      expect(result).toBeNull()
    })

    it('should return the scene group with parcels', async () => {
      const created = await sceneGroupsDb.createSceneGroup({
        name: 'My Group',
        description: 'Description here',
        color: '#AABBCC',
        tags: ['tag1'],
        parcels: [{ x: 20, y: 30 }]
      })

      const result = await sceneGroupsDb.getSceneGroupById(created.id)

      expect(result).not.toBeNull()
      expect(result!.id).toBe(created.id)
      expect(result!.name).toBe('My Group')
      expect(result!.parcels).toEqual([{ x: 20, y: 30 }])
    })
  })

  describe('getSceneGroupByParcel', () => {
    it('should return null when no group contains the parcel', async () => {
      const result = await sceneGroupsDb.getSceneGroupByParcel(999, 999)
      expect(result).toBeNull()
    })

    it('should return the scene group containing the parcel', async () => {
      const created = await sceneGroupsDb.createSceneGroup({
        name: 'Parcel Group',
        color: '#123456',
        parcels: [{ x: 50, y: 50 }, { x: 51, y: 50 }, { x: 52, y: 50 }]
      })

      const result = await sceneGroupsDb.getSceneGroupByParcel(51, 50)

      expect(result).not.toBeNull()
      expect(result!.id).toBe(created.id)
      expect(result!.name).toBe('Parcel Group')
      expect(result!.parcels).toHaveLength(3)
    })

    it('should handle negative coordinates', async () => {
      await sceneGroupsDb.createSceneGroup({
        name: 'Negative Coords',
        color: '#000000',
        parcels: [{ x: -10, y: -20 }]
      })

      const result = await sceneGroupsDb.getSceneGroupByParcel(-10, -20)

      expect(result).not.toBeNull()
      expect(result!.name).toBe('Negative Coords')
    })
  })

  describe('updateSceneGroup', () => {
    it('should return null when group does not exist', async () => {
      const result = await sceneGroupsDb.updateSceneGroup('00000000-0000-0000-0000-000000000000', { name: 'New Name' })
      expect(result).toBeNull()
    })

    it('should update only the provided fields', async () => {
      const created = await sceneGroupsDb.createSceneGroup({
        name: 'Original Name',
        description: 'Original Description',
        color: '#111111',
        tags: ['original'],
        parcels: [{ x: 0, y: 0 }]
      })

      const result = await sceneGroupsDb.updateSceneGroup(created.id, { name: 'Updated Name' })

      expect(result).not.toBeNull()
      expect(result!.name).toBe('Updated Name')
      expect(result!.description).toBe('Original Description')
      expect(result!.color).toBe('#111111')
      expect(result!.tags).toEqual(['original'])
    })

    it('should update parcels when provided', async () => {
      const created = await sceneGroupsDb.createSceneGroup({
        name: 'Parcel Update Test',
        color: '#222222',
        parcels: [{ x: 0, y: 0 }, { x: 1, y: 0 }]
      })

      const result = await sceneGroupsDb.updateSceneGroup(created.id, {
        parcels: [{ x: 100, y: 100 }, { x: 101, y: 100 }, { x: 102, y: 100 }]
      })

      expect(result!.parcels).toHaveLength(3)
      expect(result!.parcels).toContainEqual({ x: 100, y: 100 })
      expect(result!.parcels).toContainEqual({ x: 101, y: 100 })
      expect(result!.parcels).toContainEqual({ x: 102, y: 100 })
    })

    it('should fail when updating parcels to one that belongs to another group', async () => {
      await sceneGroupsDb.createSceneGroup({
        name: 'Group A',
        color: '#AAAAAA',
        parcels: [{ x: 200, y: 200 }]
      })

      const groupB = await sceneGroupsDb.createSceneGroup({
        name: 'Group B',
        color: '#BBBBBB',
        parcels: [{ x: 300, y: 300 }]
      })

      await expect(sceneGroupsDb.updateSceneGroup(groupB.id, {
        parcels: [{ x: 200, y: 200 }]
      })).rejects.toThrow()
    })
  })

  describe('deleteSceneGroup', () => {
    it('should return false when group does not exist', async () => {
      const result = await sceneGroupsDb.deleteSceneGroup('00000000-0000-0000-0000-000000000000')
      expect(result).toBe(false)
    })

    it('should delete the group and its parcels', async () => {
      const created = await sceneGroupsDb.createSceneGroup({
        name: 'To Delete',
        color: '#FFFFFF',
        parcels: [{ x: 500, y: 500 }]
      })

      const result = await sceneGroupsDb.deleteSceneGroup(created.id)

      expect(result).toBe(true)
      expect(await sceneGroupsDb.getSceneGroupById(created.id)).toBeNull()
      expect(await sceneGroupsDb.getSceneGroupByParcel(500, 500)).toBeNull()
    })
  })
})
