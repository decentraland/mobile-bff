// This file is the "test-environment" analogous for src/components.ts
// Here we define the test components to be used in the testing environment

import { createRunner, createLocalFetchCompoment } from "@well-known-components/test-helpers"
import { createDotEnvConfigComponent } from "@well-known-components/env-config-provider"
import { createLogComponent } from "@well-known-components/logger"
import { createMetricsComponent } from "@well-known-components/metrics"
import { createFetchComponent } from "@well-known-components/fetch-component"
import {
  createServerComponent,
  instrumentHttpServerWithPromClientRegistry
} from "@well-known-components/http-server"

import { main } from "../src/service"
import { TestComponents, GlobalContext } from "../src/types"
import { metricDeclarations } from "../src/metrics"
import { createDbMockComponent } from "./mocks/db-mock"
import { createSlackMockComponent } from "./mocks/slack-mock"

/**
 * Behaves like Jest "describe" function, used to describe a test for a
 * use case, it creates a whole new program and components to run an
 * isolated test.
 *
 * State is persistent within the steps of the test.
 */
export const test = createRunner<TestComponents>({
  main,
  initComponents,
})

async function initComponents(): Promise<TestComponents> {
  // Use a random high port for tests
  const testPort = String(Math.floor(Math.random() * 10000) + 40000)
  process.env.HTTP_SERVER_PORT = testPort

  const config = await createDotEnvConfigComponent({ path: [".env.default", ".env"] })
  const metrics = await createMetricsComponent(metricDeclarations, { config })
  const logs = await createLogComponent({ metrics })
  const fetch = await createFetchComponent()
  const server = await createServerComponent<GlobalContext>({ config, logs }, {})

  // Use mock components for testing (no real DB needed)
  const pg = {
    query: jest.fn(),
    getPool: jest.fn(),
    start: jest.fn(),
    stop: jest.fn()
  } as any

  const db = createDbMockComponent()
  const slack = createSlackMockComponent()

  await instrumentHttpServerWithPromClientRegistry({ metrics, server, config, registry: metrics.registry! })

  return {
    config,
    logs,
    server,
    metrics,
    fetch,
    pg,
    db,
    slack,
    localFetch: await createLocalFetchCompoment(config),
  }
}
