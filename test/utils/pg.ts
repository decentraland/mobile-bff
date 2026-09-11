import { createPgComponent, IPgComponent } from '@well-known-components/pg-component'
import type { IConfigComponent, ILoggerComponent, IMetricsComponent } from '@well-known-components/interfaces'
import { metricDeclarations } from '../../src/metrics'

/**
 * Build the connection string the integration suites share, from the same env vars the
 * service reads.
 */
export async function getDbConnectionString(config: IConfigComponent): Promise<string> {
  const databaseUrl: string | undefined = await config.getString('PG_COMPONENT_PSQL_CONNECTION_STRING')
  if (databaseUrl) {
    return databaseUrl
  }
  const dbUser = await config.requireString('PG_COMPONENT_PSQL_USER')
  const dbDatabaseName = await config.requireString('PG_COMPONENT_PSQL_DATABASE')
  const dbPort = await config.requireString('PG_COMPONENT_PSQL_PORT')
  const dbHost = await config.requireString('PG_COMPONENT_PSQL_HOST')
  const dbPassword = await config.requireString('PG_COMPONENT_PSQL_PASSWORD')
  return `postgres://${dbUser}:${dbPassword}@${dbHost}:${dbPort}/${dbDatabaseName}`
}

const MIGRATION_LOCK_MESSAGE = 'Another migration is already running'
const MAX_ATTEMPTS = 20
const RETRY_DELAY_MS = 250

/**
 * Start a pg component with migrations, waiting out a concurrent migration if one is running.
 *
 * Jest runs suites in parallel workers against a single `mobile_test` database, and
 * node-pg-migrate takes an advisory lock for the duration. Whichever suite arrives second
 * gets "Another migration is already running" and fails before a single test runs — a flake
 * that has nothing to do with what the suite is testing.
 *
 * Waiting is the whole fix: migrations are idempotent, so by the time the lock frees there is
 * nothing left to apply. Retrying here rather than serialising all of jest keeps the rest of
 * the suite parallel.
 */
export async function startPgWithMigrations(components: {
  config: IConfigComponent
  logs: ILoggerComponent
  metrics: IMetricsComponent<keyof typeof metricDeclarations>
}): Promise<IPgComponent> {
  const databaseUrl = await getDbConnectionString(components.config)

  for (let attempt = 1; ; attempt++) {
    const pg = await createPgComponent(components, {
      migration: {
        databaseUrl,
        dir: __dirname + '/../../dist/migrations',
        migrationsTable: 'pgmigrations',
        ignorePattern: '.*\\.map',
        direction: 'up'
      }
    })

    try {
      await pg.start()
      return pg
    } catch (error) {
      // The pool is already open at this point; leaking one per attempt would exhaust
      // Postgres' connection limit long before the retries run out.
      await pg.stop().catch(() => undefined)

      const isLockContention = String((error as Error)?.message ?? error).includes(MIGRATION_LOCK_MESSAGE)
      if (!isLockContention || attempt >= MAX_ATTEMPTS) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
    }
  }
}
