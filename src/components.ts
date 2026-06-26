import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import {
  createServerComponent,
  createStatusCheckComponent,
  instrumentHttpServerWithPromClientRegistry
} from '@well-known-components/http-server'
import { createLogComponent } from '@well-known-components/logger'
import { createMetricsComponent } from '@dcl/metrics'
import { createFetchComponent } from '@well-known-components/fetch-component'
import { createPgComponent } from '@dcl/pg-component'
import { AppComponents, GlobalContext } from './types'
import { metricDeclarations } from './metrics'
import { createDbComponent } from './adapters/db'
import { createSlackComponent } from './adapters/slack'
import { createSceneGroupsDbComponent } from './adapters/scene-groups-db'
import { createBansDbComponent } from './adapters/bans-db'
import { createTagsDbComponent } from './adapters/tags-db'
import { createPlacesDbComponent } from './adapters/places-db'
import { createPlaceGroupsDbComponent } from './adapters/place-groups-db'
import { createCacheComponent } from './adapters/cache'
import { createDestinationsApiComponent } from './adapters/destinations-api'
import { createAppVersionsDbComponent } from './adapters/app-versions-db'
import { createAppAttestComponent } from './adapters/app-attest'
import { createPlayIntegrityComponent } from './adapters/play-integrity'
import { createAttestationVerifierComponent } from './adapters/attestation-verifier'
import { createAttestationSessionComponent } from './adapters/attestation-session'
import { createThirdwebProxyComponent } from './adapters/thirdweb-proxy'
import { createRateLimiterComponent } from './adapters/rate-limiter'
import { createMagicComponent } from './adapters/magic'

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
  const placesDb = await createPlacesDbComponent({ pg })
  const placeGroupsDb = await createPlaceGroupsDbComponent({ pg })
  const cache = await createCacheComponent({ config })
  const destinationsApi = await createDestinationsApiComponent({ fetch, config, cache, logs })
  const appVersionsDb = await createAppVersionsDbComponent({ pg })
  const appAttest = await createAppAttestComponent({ config })
  const playIntegrity = await createPlayIntegrityComponent({ config })
  const attestationVerifier = await createAttestationVerifierComponent({
    appAttest,
    playIntegrity,
    logs,
    metrics
  })
  const attestationSession = await createAttestationSessionComponent({ config })
  const thirdwebProxy = await createThirdwebProxyComponent({ config, fetch, logs, metrics })
  const rateLimiter = await createRateLimiterComponent({ metrics })
  const magic = await createMagicComponent({ config, fetch, logs })

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
    tagsDb,
    placesDb,
    placeGroupsDb,
    cache,
    destinationsApi,
    appVersionsDb,
    appAttest,
    playIntegrity,
    attestationVerifier,
    attestationSession,
    thirdwebProxy,
    rateLimiter,
    magic
  }
}
