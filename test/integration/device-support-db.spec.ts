import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import { createMetricsComponent } from '@well-known-components/metrics'
import { createPgComponent, IPgComponent } from '@well-known-components/pg-component'
import { metricDeclarations } from '../../src/metrics'
import { createDeviceSupportDbComponent, IDeviceSupportDbComponent } from '../../src/adapters/device-support-db'

// These tests require a real PostgreSQL database and are designed to run in CI
// Skip locally if PostgreSQL is not available
const runDbTests = process.env.CI === 'true' || process.env.RUN_DB_TESTS === 'true'

;(runDbTests ? describe : describe.skip)('device-support-db integration tests', () => {
  const TEST_ADDRESS = '0x1234567890123456789012345678901234567890'

  let pg: IPgComponent
  let deviceSupportDb: IDeviceSupportDbComponent

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

    deviceSupportDb = await createDeviceSupportDbComponent({ pg })
  })

  afterAll(async () => {
    if (pg) {
      // Leave the shared mobile_test database in its seeded state for other suites
      await restoreSeededState()
      await pg.stop()
    }
  })

  beforeEach(restoreSeededState)

  // The migration's ~320 seed rows all have updated_by = NULL. Every test below writes only to
  // synthetic soc names, so anything with updated_by set is test fallout, safe to sweep away.
  async function restoreSeededState() {
    await pg.query(`DELETE FROM device_soc_support WHERE updated_by IS NOT NULL`)
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

  describe('getDecision', () => {
    it('should return the seeded decision for a known SoC', async () => {
      expect(await deviceSupportDb.getDecision('MT6765')).toBe('exclude')
      expect(await deviceSupportDb.getDecision('SM4350')).toBe('below-minspec')
    })

    it('should be case-insensitive', async () => {
      expect(await deviceSupportDb.getDecision('mt6765')).toBe('exclude')
    })

    it("should default to 'keep' for a SoC with no row", async () => {
      expect(await deviceSupportDb.getDecision('SM8750')).toBe('keep')
    })
  })

  describe('getAll', () => {
    it('should return the full seeded list', async () => {
      const entries = await deviceSupportDb.getAll()

      expect(entries.length).toBeGreaterThanOrEqual(320)
      expect(entries.find(e => e.soc === 'MT6765')).toMatchObject({ soc: 'MT6765', decision: 'exclude' })
    })
  })

  describe('upsert', () => {
    it('should insert a new entry, normalized to uppercase', async () => {
      const entry = await deviceSupportDb.upsert('test-soc-1', 'exclude', TEST_ADDRESS)

      expect(entry).toMatchObject({ soc: 'TEST-SOC-1', decision: 'exclude', updatedBy: TEST_ADDRESS })
      expect(await deviceSupportDb.getDecision('test-soc-1')).toBe('exclude')
    })

    it('should update an existing entry on conflict', async () => {
      await deviceSupportDb.upsert('test-soc-2', 'exclude', TEST_ADDRESS)
      const updated = await deviceSupportDb.upsert('test-soc-2', 'below-minspec', TEST_ADDRESS)

      expect(updated.decision).toBe('below-minspec')
      expect(await deviceSupportDb.getDecision('test-soc-2')).toBe('below-minspec')
    })
  })

  describe('bulkUpsert', () => {
    it('should insert multiple entries atomically', async () => {
      const count = await deviceSupportDb.bulkUpsert(
        [
          { soc: 'test-bulk-1', decision: 'exclude' },
          { soc: 'test-bulk-2', decision: 'below-minspec' }
        ],
        TEST_ADDRESS
      )

      expect(count).toBe(2)
      expect(await deviceSupportDb.getDecision('test-bulk-1')).toBe('exclude')
      expect(await deviceSupportDb.getDecision('test-bulk-2')).toBe('below-minspec')
    })
  })

  describe('delete', () => {
    it('should delete an existing entry and return true', async () => {
      await deviceSupportDb.upsert('test-soc-3', 'exclude', TEST_ADDRESS)

      expect(await deviceSupportDb.delete('test-soc-3')).toBe(true)
      expect(await deviceSupportDb.getDecision('test-soc-3')).toBe('keep')
    })

    it('should return false for a missing entry', async () => {
      expect(await deviceSupportDb.delete('does-not-exist')).toBe(false)
    })
  })
})
