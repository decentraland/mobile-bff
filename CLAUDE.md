# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build      # Compile TypeScript to dist/
npm run dev        # Run with nodemon (hot reload)
npm run start      # Run compiled code from dist/
npm run test       # Run all tests with coverage
npm run migrate # Run database migrations

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

#### Account Deletion
All deletion endpoints require **signed fetch** (ADR-44) for authentication:

- `POST /deletion` - Request account deletion
- `GET /deletion` - Check deletion request status
- `DELETE /deletion` - Cancel pending deletion request

The user's Ethereum address is extracted from the signed request via `verification.auth`.

#### Places (Public)

The `/places` endpoint provides unified access to scene groups, worlds, and parcels:

- `GET /places?world=name` - Get world group info with ban status
- `GET /places?tag=tag1,tag2` - Get groups matching ALL tags (AND logic, comma-separated)
- `GET /places?parcel=x,y` - Get scene/group info with ban status

#### App Versions (Public)

The force-update gate godot-explorer reads on boot. One row per **track**:

- `GET /app-versions` - the `legacy` track, the only one clients up to 1.13.1 can call
- `GET /app-versions/:track` - e.g. `/app-versions/v2`, what 1.13.2+ clients read
- `GET/PUT /backoffice/app-versions` - list every track / write one (defaults to `legacy`)

**Never raise `legacy.minimalRequiredVersionNumber` above `LEGACY_MINIMAL_VERSION_CAP`**
(`src/logic/app-version-tracks.ts`). Clients 1.12.0-1.13.1 draw the update overlay beneath
the startup splash and never dismiss it, so a hard gate leaves them on an unrecoverable
spinner. The handler enforces the cap; soft gates (`recommendedVersionNumber`) still work
on those builds and stay unrestricted.

#### Content Moderation (Backoffice)

Backoffice endpoints require signed fetch + wallet address in `ALLOWED_USERS` env var:

- `GET/POST/PUT/DELETE /backoffice/scene-groups` - Manage scene groups
- `GET/POST/DELETE /backoffice/bans` - Manage bans (groups, scenes, worlds)
- `GET/POST/DELETE /backoffice/tags` - Manage tags

#### Multi-Tag Filtering

The database layer supports filtering by multiple tags with AND logic:

```typescript
// Returns groups that have ALL specified tags
await sceneGroupsDb.getAllSceneGroups(['featured', 'allowed_ios'])
```

SQL implementation uses COUNT + ANY to ensure all tags match:
```sql
WHERE (
  SELECT COUNT(DISTINCT t.name)
  FROM scene_group_tags sgt
  JOIN tags t ON t.id = sgt.tag_id
  WHERE sgt.group_id = sg.id AND t.name = ANY($1)
) = array_length($1, 1)
```

### Handler Pattern with Signed Fetch

```ts
import { DecentralandSignatureContext } from '@dcl/crypto-middleware'

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

Deletion requests and cancellations are reported via Slack Webhook. Configure `SLACK_WEBHOOK_URL` in `.env`.

### Testing

- **Unit tests** (`test/unit/`) - Test handlers directly with mock components
- **Integration tests** (`test/integration/`) - Use `test/components.ts` which creates a real server with `localFetch`

### Adding New Metrics

Define metrics in `src/metrics.ts` using `IMetricsComponent.CounterType`, `GaugeType`, or `HistogramType`.

### Scripts

#### Import Curated Scenes

`scripts/import-curated-scenes.ts` - Imports curated scenes and worlds from a Google Sheet:

```bash
# Preview only (dry run)
DRY_RUN=true npx ts-node scripts/import-curated-scenes.ts

# Actually create scene groups
API_BASE=http://localhost:3000 npx ts-node scripts/import-curated-scenes.ts
```

The script:
1. Fetches CSV from the configured Google Sheet URL
2. Parses rows where `Curated=Yes`
3. Extracts tags from `Allowed iOS` and `Featured` columns
4. Creates scene groups via the backoffice API with signed requests
