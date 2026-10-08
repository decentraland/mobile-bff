// This file is the "test-environment" analogous for src/components.ts
// Here we define the test components to be used in the testing environment

import { generateKeyPairSync } from "node:crypto"
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
  // No background dispatching during tests. startComponents() starts the real dispatcher,
  // and its 5s timer would claim deliveries from whichever suite happens to have rows in
  // flight. push-db.spec drives tick() by hand instead.
  process.env.PUSH_DISPATCH_INTERVAL_MS = '0'
  // One port per suite, not one per Jest worker. Every integration suite boots a real HTTP
  // server; a worker runs its suites one after another, and the socket the previous one held
  // is not always released by the time the next one binds, so the loser dies with EADDRINUSE
  // on a port nothing is listening on any more. The worker id spaces the workers apart and
  // the sequence spaces the suites inside one worker. Starting at 9200 keeps the range clear
  // of 9101, which is also where a metrics server would land by convention.
  //
  // The sequence lives in process.env because that is the only thing here that outlives a
  // suite: Jest builds a fresh module registry and a fresh global object for every test file,
  // so a counter in module or global scope restarts at 0 on each one and hands every suite in
  // the worker the same port.
  const suiteIndex = Number(process.env.SUITE_PORT_SEQUENCE ?? '0') + 1
  process.env.SUITE_PORT_SEQUENCE = String(suiteIndex)
  process.env.HTTP_SERVER_PORT = String(9200 + Number(process.env.JEST_WORKER_ID ?? 1) * 100 + suiteIndex)
  // Attestation session secret: production deploys must set their own, but
  // the integration test runner needs *some* value that passes the 32-char
  // length check at startup. This deterministic test value is fine because
  // the integration tests don't exercise the /attest/session token flow.
  process.env.ATTESTATION_SESSION_SECRET =
    process.env.ATTESTATION_SESSION_SECRET || 'test-attestation-session-secret-for-integration-only'
  // Play Integrity service-account JSON: `.env.default` ships this empty so
  // it documents the var without leaking creds, but createPlayIntegrityComponent
  // eagerly base64-decodes + JSON.parses it at construction. The integration
  // tests don't exercise the Android verdict flow, so a syntactically valid
  // placeholder is enough — google.auth.GoogleAuth only validates the key
  // when actually fetching a token.
  process.env.PLAY_INTEGRITY_SA_JSON =
    process.env.PLAY_INTEGRITY_SA_JSON ||
    Buffer.from(
      JSON.stringify({ client_email: 'integration-test@example.com', private_key: 'integration-test-key' }),
      'utf8'
    ).toString('base64')

  // FCM service account: same story as PLAY_INTEGRITY_SA_JSON above -- createFcmComponent
  // decodes and parses it at construction, and the integration tests never send a push.
  process.env.FCM_SA_JSON =
    process.env.FCM_SA_JSON ||
    Buffer.from(
      JSON.stringify({
        client_email: 'integration-test@example.com',
        private_key: 'integration-test-key',
        project_id: 'integration-test-project'
      }),
      'utf8'
    ).toString('base64')

  // APNs auth key: createApnsComponent parses the .p8 at construction and only signs at
  // send time, which the integration tests never reach, so a throwaway EC key is enough.
  if (!process.env.APNS_KEY_P8) {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    process.env.APNS_KEY_P8 = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64')
    process.env.APNS_KEY_ID = 'TESTKEYID0'
    process.env.APNS_TEAM_ID = 'TESTTEAM00'
  }

  const components = await originalInitComponents()

  return {
    ...components,
    localFetch: await createLocalFetchCompoment(components.config),
  }
}
