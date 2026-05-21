// This file is the "test-environment" analogous for src/components.ts
// Here we define the test components to be used in the testing environment

import { createRunner, createLocalFetchCompoment } from "@well-known-components/test-helpers"
import { createDotEnvConfigComponent } from "@well-known-components/env-config-provider"

import { main } from "../src/service"
import { TestComponents } from "../src/types"
import { initComponents as originalInitComponents } from "../src/components"

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
  // Use test database
  process.env.PG_COMPONENT_PSQL_DATABASE = 'mobile_test'
  // Attestation session secret: production deploys must set their own, but
  // the integration test runner needs *some* value that passes the 32-char
  // length check at startup. This deterministic test value is fine because
  // the integration tests don't exercise the /attest/session token flow.
  process.env.ATTESTATION_SESSION_SECRET =
    process.env.ATTESTATION_SESSION_SECRET || 'test-attestation-session-secret-for-integration-only'

  const components = await originalInitComponents()

  return {
    ...components,
    localFetch: await createLocalFetchCompoment(components.config),
  }
}
