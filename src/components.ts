import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import {
  createServerComponent,
  createStatusCheckComponent,
  instrumentHttpServerWithPromClientRegistry
} from '@well-known-components/http-server'
import { createLogComponent } from '@well-known-components/logger'
import { createMetricsComponent } from '@well-known-components/metrics'
import { createFetchComponent } from '@well-known-components/fetch-component'
import { createPgComponent } from '@well-known-components/pg-component'
import { AppComponents, GlobalContext } from './types'
import { metricDeclarations } from './metrics'
import { createDbComponent } from './adapters/db'
import { createSlackComponent } from './adapters/slack'
import { createSceneGroupsDbComponent } from './adapters/scene-groups-db'
import { createBansDbComponent } from './adapters/bans-db'
import { createTagsDbComponent } from './adapters/tags-db'

// Initialize all the components of the app
export async function initComponents(): Promise<AppComponents> {
  const config = await createDotEnvConfigComponent({ path: ['.env.default', '.env'] })
  const metrics = await createMetricsComponent(metricDeclarations, { config })
  const logs = await createLogComponent({ metrics })
  const fetch = await createFetchComponent()
  const server = await createServerComponent<GlobalContext>({ config, logs }, {
    cors: {
      origin: '*',
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['*']
    }
  })
  const statusChecks = await createStatusCheckComponent({ server, config })

  const pg = await createPgComponent({ logs, config, metrics }, {
    migration: {
      databaseUrl: await getDbConnectionString({ config }),
      dir: __dirname + '/migrations',
      migrationsTable: 'pgmigrations',
      ignorePattern: '.*\\.map',
      direction: 'up'
    }
  })

  const db = await createDbComponent({ pg })
  const slack = await createSlackComponent({ config, fetch, logs })
  const sceneGroupsDb = await createSceneGroupsDbComponent({ pg })
  const bansDb = await createBansDbComponent({ pg })
  const tagsDb = await createTagsDbComponent({ pg })

  await instrumentHttpServerWithPromClientRegistry({ metrics, server, config, registry: metrics.registry! })

  return {
    config,
    logs,
    server,
    statusChecks,
    metrics,
    fetch,
    pg,
    db,
    slack,
    sceneGroupsDb,
    bansDb,
    tagsDb
  }
}

async function getDbConnectionString({ config }: Pick<AppComponents, 'config'>): Promise<string> {
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
