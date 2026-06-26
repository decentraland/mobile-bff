import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import { createMetricsComponent } from '@dcl/metrics'
import { createPgComponent, IPgComponent } from '@dcl/pg-component'
import { metricDeclarations } from '../../src/metrics'
import { createBansDbComponent, IBansDbComponent } from '../../src/adapters/bans-db'
import { createSceneGroupsDbComponent, ISceneGroupsDbComponent } from '../../src/adapters/scene-groups-db'

// These tests require a real PostgreSQL database and are designed to run in CI
// Skip locally if PostgreSQL is not available
const runDbTests = process.env.CI === 'true' || process.env.RUN_DB_TESTS === 'true'

;(runDbTests ? describe : describe.skip)('bans-db integration tests', () => {
  let pg: IPgComponent
  let bansDb: IBansDbComponent
  let sceneGroupsDb: ISceneGroupsDbComponent
  let testGroupId: string

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

    bansDb = await createBansDbComponent({ pg })
    sceneGroupsDb = await createSceneGroupsDbComponent({ pg })
  })

  afterAll(async () => {
    if (pg) {
      await pg.stop()
    }
  })

  beforeEach(async () => {
    // Clean up tables before each test (order matters due to FK constraints)
    await pg.query('DELETE FROM ban_positions')
    await pg.query('DELETE FROM bans')
    await pg.query('DELETE FROM scene_group_parcels')
    await pg.query('DELETE FROM scene_groups')

    // Create a test group for group ban tests
    const group = await sceneGroupsDb.createSceneGroup({
      name: 'Test Group for Bans',
      color: '#FF0000',
      parcels: [{ x: 100, y: 100 }]
    })
    testGroupId = group.id
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

  describe('createGroupBan', () => {
    it('should create a group ban', async () => {
      const result = await bansDb.createGroupBan(
        { groupId: testGroupId, reason: 'Test reason' },
        '0x1234567890123456789012345678901234567890'
      )

      expect(result.id).toBeDefined()
      expect(result.groupId).toBe(testGroupId)
      expect(result.positions).toEqual([])
      expect(result.reason).toBe('Test reason')
      expect(result.createdBy).toBe('0x1234567890123456789012345678901234567890')
      expect(result.createdAt).toBeDefined()
    })

    it('should create a group ban without reason', async () => {
      const result = await bansDb.createGroupBan(
        { groupId: testGroupId },
        '0x1234567890123456789012345678901234567890'
      )

      expect(result.groupId).toBe(testGroupId)
      expect(result.reason).toBeUndefined()
    })

    it('should fail when group is already banned', async () => {
      await bansDb.createGroupBan(
        { groupId: testGroupId },
        '0x1234567890123456789012345678901234567890'
      )

      await expect(
        bansDb.createGroupBan(
          { groupId: testGroupId },
          '0x1234567890123456789012345678901234567890'
        )
      ).rejects.toThrow()
    })

    it('should fail when group does not exist', async () => {
      await expect(
        bansDb.createGroupBan(
          { groupId: '00000000-0000-0000-0000-000000000000' },
          '0x1234567890123456789012345678901234567890'
        )
      ).rejects.toThrow()
    })
  })

  describe('createSceneBan', () => {
    it('should create a scene ban with positions', async () => {
      const positions = ['0,0', '1,0', '0,1']
      const result = await bansDb.createSceneBan(
        { positions, reason: 'Scene ban reason' },
        '0xABCDEF1234567890123456789012345678901234'
      )

      expect(result.id).toBeDefined()
      expect(result.groupId).toBeNull()
      expect(result.positions).toHaveLength(3)
      expect(result.positions).toContain('0,0')
      expect(result.positions).toContain('1,0')
      expect(result.positions).toContain('0,1')
      expect(result.reason).toBe('Scene ban reason')
      expect(result.createdBy).toBe('0xABCDEF1234567890123456789012345678901234')
    })

    it('should create a scene ban without reason', async () => {
      const result = await bansDb.createSceneBan(
        { positions: ['50,50'] },
        '0x1234567890123456789012345678901234567890'
      )

      expect(result.positions).toEqual(['50,50'])
      expect(result.reason).toBeUndefined()
    })

    it('should handle negative parcel coordinates', async () => {
      const positions = ['-10,-20', '-11,-20']
      const result = await bansDb.createSceneBan(
        { positions },
        '0x1234567890123456789012345678901234567890'
      )

      expect(result.positions).toHaveLength(2)
      expect(result.positions).toContain('-10,-20')
      expect(result.positions).toContain('-11,-20')
    })

    it('should fail when positions array is empty', async () => {
      await expect(
        bansDb.createSceneBan(
          { positions: [] },
          '0x1234567890123456789012345678901234567890'
        )
      ).rejects.toThrow('Scene ban requires at least one position')
    })
  })

  describe('getAllBans', () => {
    it('should return empty array when no bans exist', async () => {
      const result = await bansDb.getAllBans()
      expect(result).toEqual([])
    })

    it('should return all bans with their data', async () => {
      await bansDb.createGroupBan(
        { groupId: testGroupId, reason: 'Group ban' },
        '0x1111111111111111111111111111111111111111'
      )
      await bansDb.createSceneBan(
        { positions: ['0,0'], reason: 'Scene ban' },
        '0x2222222222222222222222222222222222222222'
      )

      const result = await bansDb.getAllBans()

      expect(result).toHaveLength(2)
      // Ordered by created_at DESC
      const sceneBan = result.find(b => b.groupId === null)
      const groupBan = result.find(b => b.groupId !== null)

      expect(groupBan).toBeDefined()
      expect(groupBan!.groupId).toBe(testGroupId)
      expect(groupBan!.reason).toBe('Group ban')

      expect(sceneBan).toBeDefined()
      expect(sceneBan!.groupId).toBeNull()
      expect(sceneBan!.positions).toEqual(['0,0'])
      expect(sceneBan!.reason).toBe('Scene ban')
    })
  })

  describe('getBanById', () => {
    it('should return null when ban does not exist', async () => {
      const result = await bansDb.getBanById('00000000-0000-0000-0000-000000000000')
      expect(result).toBeNull()
    })

    it('should return the ban with positions for scene ban', async () => {
      const created = await bansDb.createSceneBan(
        { positions: ['20,30', '21,30'] },
        '0x1234567890123456789012345678901234567890'
      )

      const result = await bansDb.getBanById(created.id)

      expect(result).not.toBeNull()
      expect(result!.id).toBe(created.id)
      expect(result!.positions).toHaveLength(2)
    })

    it('should return empty positions for group ban', async () => {
      const created = await bansDb.createGroupBan(
        { groupId: testGroupId },
        '0x1234567890123456789012345678901234567890'
      )

      const result = await bansDb.getBanById(created.id)

      expect(result).not.toBeNull()
      expect(result!.id).toBe(created.id)
      expect(result!.groupId).toBe(testGroupId)
      expect(result!.positions).toEqual([])
    })
  })

  describe('getBanByGroupId', () => {
    it('should return null when group is not banned', async () => {
      const result = await bansDb.getBanByGroupId(testGroupId)
      expect(result).toBeNull()
    })

    it('should return the ban when group is banned', async () => {
      const created = await bansDb.createGroupBan(
        { groupId: testGroupId, reason: 'Test' },
        '0x1234567890123456789012345678901234567890'
      )

      const result = await bansDb.getBanByGroupId(testGroupId)

      expect(result).not.toBeNull()
      expect(result!.id).toBe(created.id)
      expect(result!.groupId).toBe(testGroupId)
    })
  })

  describe('getBanByPosition', () => {
    it('should return null when position is not in any ban', async () => {
      const result = await bansDb.getBanByPosition('999,999')
      expect(result).toBeNull()
    })

    it('should return the ban when position matches', async () => {
      const ban = await bansDb.createSceneBan(
        { positions: ['10,20'] },
        '0x1234567890123456789012345678901234567890'
      )

      const result = await bansDb.getBanByPosition('10,20')

      expect(result).not.toBeNull()
      expect(result!.id).toBe(ban.id)
    })

    it('should find ban when querying a position that is part of multi-position ban', async () => {
      const ban = await bansDb.createSceneBan(
        { positions: ['10,20', '11,20'] },
        '0x1234567890123456789012345678901234567890'
      )

      const result = await bansDb.getBanByPosition('10,20')

      expect(result).not.toBeNull()
      expect(result!.id).toBe(ban.id)
      // Should include all positions from the ban
      expect(result!.positions).toHaveLength(2)
    })

    it('should handle negative coordinates', async () => {
      const ban = await bansDb.createSceneBan(
        { positions: ['-10,-20'] },
        '0x1234567890123456789012345678901234567890'
      )

      const result = await bansDb.getBanByPosition('-10,-20')

      expect(result).not.toBeNull()
      expect(result!.id).toBe(ban.id)
    })
  })

  describe('deleteBan', () => {
    it('should return false when ban does not exist', async () => {
      const result = await bansDb.deleteBan('00000000-0000-0000-0000-000000000000')
      expect(result).toBe(false)
    })

    it('should delete a group ban', async () => {
      const created = await bansDb.createGroupBan(
        { groupId: testGroupId },
        '0x1234567890123456789012345678901234567890'
      )

      const result = await bansDb.deleteBan(created.id)

      expect(result).toBe(true)
      expect(await bansDb.getBanById(created.id)).toBeNull()
      expect(await bansDb.getBanByGroupId(testGroupId)).toBeNull()
    })

    it('should delete a scene ban and its positions', async () => {
      const positions = ['500,500', '501,500']
      const created = await bansDb.createSceneBan(
        { positions },
        '0x1234567890123456789012345678901234567890'
      )

      const result = await bansDb.deleteBan(created.id)

      expect(result).toBe(true)
      expect(await bansDb.getBanById(created.id)).toBeNull()
      // Check that neither position can be found anymore
      expect(await bansDb.getBanByPosition(positions[0])).toBeNull()
    })
  })

  describe('cascade delete on group deletion', () => {
    it('should delete ban when group is deleted', async () => {
      const created = await bansDb.createGroupBan(
        { groupId: testGroupId },
        '0x1234567890123456789012345678901234567890'
      )

      // Delete the group
      await sceneGroupsDb.deleteSceneGroup(testGroupId)

      // Ban should be cascade deleted
      expect(await bansDb.getBanById(created.id)).toBeNull()
    })
  })
})
