import { IMetricsComponent } from '@well-known-components/interfaces'
import { validateMetricsDeclaration } from '@well-known-components/metrics'
import { getDefaultHttpMetrics } from '@well-known-components/http-server'
import { metricDeclarations as logsMetricsDeclarations } from '@well-known-components/logger'

export const metricDeclarations = {
  ...getDefaultHttpMetrics(),
  ...logsMetricsDeclarations,
  test_ping_counter: {
    help: 'Count calls to ping',
    type: IMetricsComponent.CounterType,
    labelNames: ['pathname']
  },
  // Attestation outcomes — one label tuple per verifier call. `ok` is the
  // happy path ("OK"), every failure carries its granular ATTESTATION_*
  // code so dashboards can spot a single code spiking instead of a flat
  // pass-rate drop.
  attestation_verify_total: {
    help: 'Total attestation verifications by platform and outcome code',
    type: IMetricsComponent.CounterType,
    labelNames: ['platform', 'code']
  },
  // Wall-clock time spent inside verifier.verify(). Includes the upstream
  // Play Integrity round-trip for android, ECDSA + CAS for ios. We bucket
  // aggressively at the low end because OK paths should be sub-100ms in
  // dev and a multi-second tail almost always means a flaky upstream.
  attestation_verify_duration_seconds: {
    help: 'Duration of attestation verification in seconds',
    type: IMetricsComponent.HistogramType,
    labelNames: ['platform', 'code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
  },
  // Anonymous rate-limit hits. Each 429 produced by the rate-limiter
  // increments this so an unexpected spike (botnet, broken client) is
  // surfaced even without inspecting per-IP logs.
  rate_limit_blocked_total: {
    help: 'Requests rejected by the in-memory rate limiter',
    type: IMetricsComponent.CounterType,
    labelNames: ['rule']
  },
  // Thirdweb upstream outcomes — separated from the attestation gate so we
  // can tell "upstream is degraded" apart from "clients are failing
  // attestation". Status is bucketed to its first digit to keep cardinality
  // bounded (2xx/4xx/5xx).
  thirdweb_proxy_requests_total: {
    help: 'Calls forwarded to the Thirdweb sign-message endpoint',
    type: IMetricsComponent.CounterType,
    labelNames: ['status_class']
  }
}

// type assertions
validateMetricsDeclaration(metricDeclarations)
