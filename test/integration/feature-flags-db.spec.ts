import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import { createMetricsComponent } from '@well-known-components/metrics'
import { createPgComponent, IPgComponent } from '@well-known-components/pg-component'
import { metricDeclarations } from '../../src/metrics'
import { createFeatureFlagsDbComponent, IFeatureFlagsDbComponent } from '../../src/adapters/feature-flags-db'

// These tests require a real PostgreSQL database and are designed to run in CI
// Skip locally if PostgreSQL is not available
const runDbTests = process.env.CI === 'true' || process.env.RUN_DB_TESTS === 'true'

;(runDbTests ? describe : describe.skip)('feature-flags-db integration tests', () => {
  const TEST_ADDRESS = '0x1234567890123456789012345678901234567890'

  let pg: IPgComponent
  let featureFlagsDb: IFeatureFlagsDbComponent

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

    featureFlagsDb = await createFeatureFlagsDbComponent({ pg })
  })

  afterAll(async () => {
    if (pg) {
      // Leave the shared mobile_test database in its seeded state for other suites
      await restoreSeededState()
      await pg.stop()
    }
  })

  beforeEach(restoreSeededState)

  async function restoreSeededState() {
    await pg.query("DELETE FROM feature_flags WHERE name NOT IN ('pulse', 'dual-channel')")
    await pg.query(`
      UPDATE feature_flags SET enabled = false, updated_by = NULL,
        description = 'Enable the ENet/UDP avatar-relay transport (Pulse) in godot-explorer'
      WHERE name = 'pulse'
    `)
    await pg.query(`
      UPDATE feature_flags SET enabled = true, updated_by = NULL,
        description = 'Keep sending movement over LiveKit while Pulse is established'
      WHERE name = 'dual-channel'
    `)
  }

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

  describe('getAll', () => {
    it('should return the seeded flags as a boolean map', async () => {
      const flags = await featureFlagsDb.getAll()

      expect(flags).toEqual({ pulse: false, 'dual-channel': true })
    })
  })

  describe('getAllDetailed', () => {
    it('should return the seeded flags with descriptions, sorted by name', async () => {
      const flags = await featureFlagsDb.getAllDetailed()

      expect(flags.map(f => f.name)).toEqual(['dual-channel', 'pulse'])
      expect(flags[1]).toMatchObject({
        name: 'pulse',
        enabled: false,
        updatedBy: null
      })
      expect(flags[1].description).toContain('Pulse')
      expect(new Date(flags[1].updatedAt).getTime()).not.toBeNaN()
    })
  })

  describe('create', () => {
    it('should insert a new flag and return it', async () => {
      const flag = await featureFlagsDb.create(
        { name: 'shiny-thing', enabled: true, description: 'A test flag' },
        TEST_ADDRESS
      )

      expect(flag).toMatchObject({
        name: 'shiny-thing',
        enabled: true,
        description: 'A test flag',
        updatedBy: TEST_ADDRESS
      })

      const map = await featureFlagsDb.getAll()
      expect(map['shiny-thing']).toBe(true)
    })

    it('should throw a unique violation for a duplicate name', async () => {
      await expect(
        featureFlagsDb.create({ name: 'pulse', enabled: false, description: null }, TEST_ADDRESS)
      ).rejects.toMatchObject({ code: '23505' })
    })

    it('should be rejected by the db CHECK constraint for a non-kebab-case name', async () => {
      // Handler validation is the first line of defense; the CHECK constraint is the backstop
      await expect(
        featureFlagsDb.create({ name: 'NOT_VALID', enabled: false, description: null }, TEST_ADDRESS)
      ).rejects.toMatchObject({ code: '23514' })
    })
  })

  describe('update', () => {
    it('should update enabled only and record the author', async () => {
      const flag = await featureFlagsDb.update('pulse', { enabled: true }, TEST_ADDRESS)

      expect(flag).toMatchObject({ name: 'pulse', enabled: true, updatedBy: TEST_ADDRESS })
      expect(flag!.description).toContain('Pulse')
    })

    it('should update the description without touching enabled', async () => {
      const flag = await featureFlagsDb.update('pulse', { description: 'New words' }, TEST_ADDRESS)

      expect(flag).toMatchObject({ name: 'pulse', enabled: false, description: 'New words' })
    })

    it('should clear the description with null', async () => {
      const flag = await featureFlagsDb.update('pulse', { description: null }, TEST_ADDRESS)

      expect(flag!.description).toBeNull()
    })

    it('should return null for a missing flag', async () => {
      const flag = await featureFlagsDb.update('not-a-flag', { enabled: true }, TEST_ADDRESS)

      expect(flag).toBeNull()
    })

    it('should not touch other flags', async () => {
      await featureFlagsDb.update('pulse', { enabled: true }, TEST_ADDRESS)

      const untouched = await pg.query("SELECT updated_by FROM feature_flags WHERE name = 'dual-channel'")
      expect(untouched.rows[0].updated_by).toBeNull()
    })

    it('should reject an empty changes object', async () => {
      await expect(featureFlagsDb.update('pulse', {}, TEST_ADDRESS)).rejects.toThrow('at least one change')
    })
  })

  describe('delete', () => {
    it('should delete an existing flag and return true', async () => {
      await featureFlagsDb.create({ name: 'doomed', enabled: false, description: null }, TEST_ADDRESS)

      const deleted = await featureFlagsDb.delete('doomed')

      expect(deleted).toBe(true)
      expect(await featureFlagsDb.getAll()).not.toHaveProperty('doomed')
    })

    it('should return false for a missing flag', async () => {
      const deleted = await featureFlagsDb.delete('not-a-flag')

      expect(deleted).toBe(false)
    })
  })
})
