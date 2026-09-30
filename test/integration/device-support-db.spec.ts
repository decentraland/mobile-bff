import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import { createMetricsComponent } from '@well-known-components/metrics'
import { createPgComponent, IPgComponent } from '@well-known-components/pg-component'
import { metricDeclarations } from '../../src/metrics'
import { createDeviceSupportDbComponent, IDeviceSupportDbComponent } from '../../src/adapters/device-support-db'
import { createCacheComponent, ICacheComponent } from '../../src/adapters/cache'
import { restoreDeviceSupportSeededState } from '../utils/device-support-seed-state'

// These tests require a real PostgreSQL database and are designed to run in CI
// Skip locally if PostgreSQL is not available
const runDbTests = process.env.CI === 'true' || process.env.RUN_DB_TESTS === 'true'

;(runDbTests ? describe : describe.skip)('device-support-db integration tests', () => {
  const TEST_ADDRESS = '0x1234567890123456789012345678901234567890'

  let pg: IPgComponent
  let cache: ICacheComponent
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

    cache = await createCacheComponent({ config })
    deviceSupportDb = await createDeviceSupportDbComponent({ pg, metrics, cache })
  })

  afterAll(async () => {
    if (pg) {
      // Leave the shared mobile_test database in its seeded state for other suites
      await restoreDeviceSupportSeededState(pg)
      await pg.stop()
    }
  })

  // restoreDeviceSupportSeededState writes with raw SQL, bypassing deviceSupportDb's own
  // invalidation -- clearing the cache here (rather than relying on every test using a soc no
  // other test touches) is what keeps a decision cached in one test from leaking into the next.
  beforeEach(async () => {
    await restoreDeviceSupportSeededState(pg)
    await cache.clear()
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

    it('should match a space-containing seeded SoC even when the query omits the space', async () => {
      // "EXYNOS 7420" is one of the 18 seeded socs with an internal space (Samsung's older
      // Exynos naming, as opposed to the newer "s5eXXXX" codename format).
      expect(await deviceSupportDb.getDecision('EXYNOS7420')).toBe('exclude')
      expect(await deviceSupportDb.getDecision('exynos 7420')).toBe('exclude')
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

    it('should update the existing row -- not create a second one -- when the same chip is upserted with different spacing', async () => {
      await deviceSupportDb.upsert('test soc spaced', 'exclude', TEST_ADDRESS)
      const second = await deviceSupportDb.upsert('testsocspaced', 'below-minspec', TEST_ADDRESS)

      // The conflict updated the one existing row (soc_model now reflects the new spelling)
      // instead of inserting a second row for the same normalized key.
      expect(second.soc).toBe('TESTSOCSPACED')
      expect(second.decision).toBe('below-minspec')

      const all = await deviceSupportDb.getAll()
      const matches = all.filter(e => e.soc.replace(/ /g, '') === 'TESTSOCSPACED')
      expect(matches).toHaveLength(1)
      expect(await deviceSupportDb.getDecision('TEST SOC SPACED')).toBe('below-minspec')
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

    it('should update, not duplicate, an existing row when re-upserted with different spacing', async () => {
      await deviceSupportDb.upsert('test bulk spaced', 'exclude', TEST_ADDRESS)
      await deviceSupportDb.bulkUpsert([{ soc: 'testbulkspaced', decision: 'below-minspec' }], TEST_ADDRESS)

      const all = await deviceSupportDb.getAll()
      expect(all.filter(e => e.soc.replace(/ /g, '') === 'TESTBULKSPACED')).toHaveLength(1)
      expect(await deviceSupportDb.getDecision('TEST BULK SPACED')).toBe('below-minspec')
    })

    it('should roll back the whole batch when one entry violates the decision CHECK constraint', async () => {
      // Bypasses the handler's own validation (which would reject this before it ever reaches
      // the db) to exercise the adapter directly: bulkUpsert runs in a transaction, so a CHECK
      // violation on the insert rolls back the whole batch, not just the offending row.
      await expect(
        deviceSupportDb.bulkUpsert(
          [
            { soc: 'test-rollback-1', decision: 'exclude' },
            { soc: 'test-rollback-2', decision: 'not-a-real-decision' as any }
          ],
          TEST_ADDRESS
        )
      ).rejects.toThrow()

      expect(await deviceSupportDb.getDecision('test-rollback-1')).toBe('keep')
      expect(await deviceSupportDb.getDecision('test-rollback-2')).toBe('keep')
    })

    it('should dedupe same-batch entries that collide on soc_key, keeping the last decision', async () => {
      // Two spellings of the same chip in one paste would make Postgres reject the whole
      // statement ("ON CONFLICT DO UPDATE command cannot affect row a second time") if they
      // both reached the VALUES list -- bulkUpsert dedupes by soc_key first, last one wins.
      const count = await deviceSupportDb.bulkUpsert(
        [
          { soc: 'test dup spaced', decision: 'exclude' },
          { soc: 'testdupspaced', decision: 'below-minspec' }
        ],
        TEST_ADDRESS
      )

      expect(count).toBe(1)
      expect(await deviceSupportDb.getDecision('TESTDUPSPACED')).toBe('below-minspec')

      const all = await deviceSupportDb.getAll()
      expect(all.filter(e => e.soc.replace(/ /g, '') === 'TESTDUPSPACED')).toHaveLength(1)
    })

    it("should delete a row when its bulk entry's decision is 'keep'", async () => {
      await deviceSupportDb.upsert('test-bulk-keep', 'exclude', TEST_ADDRESS)

      const count = await deviceSupportDb.bulkUpsert([{ soc: 'test-bulk-keep', decision: 'keep' }], TEST_ADDRESS)

      expect(count).toBe(1)
      expect(await deviceSupportDb.getDecision('test-bulk-keep')).toBe('keep')
      expect((await deviceSupportDb.getAll()).find(e => e.soc === 'TEST-BULK-KEEP')).toBeUndefined()
    })

    it('should mix deletes and upserts in the same call, atomically', async () => {
      await deviceSupportDb.upsert('test-bulk-mixed-keep', 'exclude', TEST_ADDRESS)

      const count = await deviceSupportDb.bulkUpsert(
        [
          { soc: 'test-bulk-mixed-keep', decision: 'keep' },
          { soc: 'test-bulk-mixed-new', decision: 'below-minspec' }
        ],
        TEST_ADDRESS
      )

      expect(count).toBe(2)
      expect(await deviceSupportDb.getDecision('test-bulk-mixed-keep')).toBe('keep')
      expect(await deviceSupportDb.getDecision('test-bulk-mixed-new')).toBe('below-minspec')
    })

    it("no-ops on a 'keep' entry for a soc that has no row", async () => {
      const count = await deviceSupportDb.bulkUpsert([{ soc: 'test-bulk-keep-missing', decision: 'keep' }], TEST_ADDRESS)

      expect(count).toBe(1)
      expect(await deviceSupportDb.getDecision('test-bulk-keep-missing')).toBe('keep')
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
