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
    await pg.query("UPDATE feature_flags SET enabled = false, updated_by = NULL WHERE name = 'pulse'")
    await pg.query("UPDATE feature_flags SET enabled = true, updated_by = NULL WHERE name = 'dual-channel'")
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
    it('should return the seeded flags', async () => {
      const flags = await featureFlagsDb.getAll()

      expect(flags).toEqual({ pulse: false, 'dual-channel': true })
    })
  })

  describe('update', () => {
    it('should flip only the named flag and return the full map', async () => {
      const flags = await featureFlagsDb.update({ pulse: true }, TEST_ADDRESS)

      expect(flags).toEqual({ pulse: true, 'dual-channel': true })
    })

    it('should update several flags atomically', async () => {
      const flags = await featureFlagsDb.update({ pulse: true, 'dual-channel': false }, TEST_ADDRESS)

      expect(flags).toEqual({ pulse: true, 'dual-channel': false })
    })

    it('should record who updated the flag and bump updated_at', async () => {
      const before = await pg.query("SELECT updated_at FROM feature_flags WHERE name = 'pulse'")

      await featureFlagsDb.update({ pulse: true }, TEST_ADDRESS)

      const after = await pg.query("SELECT updated_at, updated_by FROM feature_flags WHERE name = 'pulse'")
      expect(after.rows[0].updated_by).toBe(TEST_ADDRESS)
      expect(new Date(after.rows[0].updated_at).getTime()).toBeGreaterThanOrEqual(
        new Date(before.rows[0].updated_at).getTime()
      )
    })

    it('should not touch flags that are not in the changes', async () => {
      await featureFlagsDb.update({ pulse: true }, TEST_ADDRESS)

      const untouched = await pg.query("SELECT updated_by FROM feature_flags WHERE name = 'dual-channel'")
      expect(untouched.rows[0].updated_by).toBeNull()
    })

    it('should reject an empty changes map instead of emitting invalid SQL', async () => {
      await expect(featureFlagsDb.update({}, TEST_ADDRESS)).rejects.toThrow('at least one flag change')
    })
  })
})
