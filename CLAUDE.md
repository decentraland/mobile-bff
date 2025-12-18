# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build      # Compile TypeScript to dist/
npm run dev        # Run with nodemon (hot reload)
npm run start      # Run compiled code from dist/
npm run test       # Run all tests with coverage
npm run db:migrate # Run database migrations

# Run a single test file
npx jest test/unit/ping-controller.spec.ts
```

## Architecture

This project uses **hexagonal architecture** (ports and adapters) with `@well-known-components/*` libraries.

### Layers

- **src/logic/** - Pure business logic, no side effects
- **src/controllers/** - HTTP handlers that orchestrate logic and adapters
- **src/adapters/** - Data transformation between external and internal representations (db.ts, slack.ts)
- **src/components.ts** - Dependency injection container (ports)
- **src/migrations/** - Database migrations using node-pg-migrate

### Application Lifecycle

1. `src/index.ts` - Entry point, calls `Lifecycle.run({ main, initComponents })`
2. `src/components.ts` - Creates all components (config, logs, server, metrics, pg, db, slack)
3. `src/service.ts` - Wires routes and starts the HTTP server

### API Endpoints

All deletion endpoints require **signed fetch** (ADR-44) for authentication:

- `POST /deletion` - Request account deletion
- `GET /deletion` - Check deletion request status
- `DELETE /deletion` - Cancel pending deletion request

The user's Ethereum address is extracted from the signed request via `verification.auth`.

### Handler Pattern with Signed Fetch

```ts
import { DecentralandSignatureContext } from '@dcl/platform-crypto-middleware'

export async function myHandler(
  context: HandlerContextWithPath<'db' | 'logs', '/path'> & DecentralandSignatureContext<any>
) {
  const userAddress = context.verification?.auth
  // ...
}
```

### Database

Uses PostgreSQL via `@well-known-components/pg-component`. Connection configured via environment variables:
- `PG_COMPONENT_PSQL_HOST`, `PG_COMPONENT_PSQL_PORT`, `PG_COMPONENT_PSQL_DATABASE`
- `PG_COMPONENT_PSQL_USER`, `PG_COMPONENT_PSQL_PASSWORD`
- Or `PG_COMPONENT_PSQL_CONNECTION_STRING`

### Slack Notifications

Deletion requests and cancellations are reported via Slack Bot API. Configure `SLACK_BOT_TOKEN` and `SLACK_CHANNEL_ID` in `.env`.

### Testing

- **Unit tests** (`test/unit/`) - Test handlers directly with mock components
- **Integration tests** (`test/integration/`) - Use `test/components.ts` which creates a real server with `localFetch`

### Adding New Metrics

Define metrics in `src/metrics.ts` using `IMetricsComponent.CounterType`, `GaugeType`, or `HistogramType`.
