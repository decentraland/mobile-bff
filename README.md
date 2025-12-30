# Mobile Backend-for-Frontend

Backend-for-frontend service for Decentraland mobile applications. Handles account deletion requests and scene groups management.

## Architecture

Extension of "ports and adapters architecture", also known as "hexagonal architecture".

With this architecture, code is organized into several layers: logic, controllers, adapters, and components (ports).

## Application lifecycle

1. **Start application lifecycle** - Handled by [src/index.ts](src/index.ts) in only one line of code: `Lifecycle.run({ main, initComponents })`
2. **Create components** - Handled by [src/components.ts](src/components.ts) in the function `initComponents`
3. **Wire application & start components** - Handled by [src/service.ts](src/service.ts) in the funciton `main`.
   1. First wire HTTP routes and other events with [controllers](#src/controllers)
   2. Then call to `startComponents()` to initialize the components (i.e. http-listener)

The same lifecycle is also valid for tests: [test/components.ts](test/components.ts)

## Namespaces

### src/logic

Deals with pure business logic and shouldn't have side-effects or throw exceptions.

### src/controllers

The "glue" between all the other layers, orchestrating calls between pure business logic and adapters.

Controllers always receive an hydrated context containing components and parameters to call the business logic e.g:

```ts
// handler for /ping
export async function pingHandler(context: {
  url: URL // parameter added by http-server
  components: AppComponents // components of the app, part of the global context
}) {
  components.metrics.increment("test_ping_counter")
  return { status: 200 }
}
```

### src/adapters

The layer that converts external data representations into internal ones, and vice-versa. Acts as buffer to protect the service from changes in the outside world; when a data representation changes, you only need to change how the adapters deal with it.

### src/components.ts

We use the components abstraction to organize our adapters (e.g. HTTP client, database client, redis client) and any other logic that needs to track mutable state or encode dependencies between stateful components. For every environment (e.g. test, e2e, prod, staging...) we have a different version of our component systems, enabling us to easily inject mocks or different implementations for different contexts.

We make components available to incoming http and kafka handlers. For instance, the http-server handlers have access to things like the database or HTTP components, and pass them down to the controller level for general use.

## API Endpoints

### Scene Groups

Scene groups allow organizing parcels into named collections for the mobile app.

#### Public Endpoints (no auth required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/scene-groups` | List all scene groups |
| GET | `/scene-groups?parcel=0,1` | Get scene group containing a specific parcel |
| GET | `/scene-groups/:id` | Get a scene group by ID |

#### Backoffice Endpoints (signedFetch + ALLOWED_USERS)

These endpoints require signed requests and the wallet address must be in the `ALLOWED_USERS` environment variable.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/backoffice/scene-groups` | List all scene groups |
| POST | `/backoffice/scene-groups` | Create a new scene group |
| PUT | `/backoffice/scene-groups/:id` | Update a scene group |
| DELETE | `/backoffice/scene-groups/:id` | Delete a scene group |

#### Scene Group Schema

```json
{
  "id": "uuid",
  "name": "Group Name",
  "description": "Optional description",
  "color": "#FF6B6B",
  "tags": ["tag1", "tag2"],
  "parcels": [{ "x": 0, "y": 0 }, { "x": 1, "y": 0 }],
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

### Account Deletion

| Method | Path | Description |
|--------|------|-------------|
| POST | `/deletion-request` | Request account deletion (signedFetch) |
| GET | `/deletion-status` | Get deletion request status (signedFetch) |
| DELETE | `/deletion-request` | Cancel deletion request (signedFetch) |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PG_COMPONENT_PSQL_*` | PostgreSQL connection settings |
| `ALLOWED_USERS` | Comma-separated wallet addresses allowed to use backoffice endpoints |
| `SLACK_WEBHOOK_URL` | Webhook for deletion request notifications |

## Database

Uses PostgreSQL with the following tables:

- `scene_groups` - Scene group metadata
- `scene_group_parcels` - Parcel coordinates (PK on x,y ensures one parcel per group)
- `deletion_requests` - Account deletion requests

Run migrations with:
```bash
npm run migrate
```
