# Mobile Backend-for-Frontend

Backend-for-frontend service for Decentraland mobile applications. Handles account deletion requests, scene groups management, and content moderation (bans).

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

## Hub Frontend

The Mobile Hub frontend (`@dcl-regenesislabs/mobile-hub`) is served as static files at `/hub/`.

### How It Works

1. The npm package is installed as a dependency
2. `hub-static-handler.ts` serves files from the package directory
3. HTML files are rewritten on-the-fly to:
   - Prefix asset paths with `/hub/` (e.g., `/assets/...` → `/hub/assets/...`)
   - Set `window.__BASE_PATH__ = "/hub"` for React Router

### Accessing the Frontend

Once deployed, access the hub at:
```
https://your-backend-url/hub/
```

### Changing the Base Path

To serve from a different path, modify `HUB_BASE_PATH` in `src/controllers/handlers/hub-static-handler.ts`:

```typescript
const HUB_BASE_PATH = '/hub'  // Change to '/app' or any other path
```

Then update the route in `src/controllers/routes.ts`:
```typescript
router.get("/app", hubStaticHandler)
router.get("/app/(.*)", hubStaticHandler)
```

---

## API Endpoints

### Scene Groups

Scene groups allow organizing parcels into named collections for the mobile app.

#### Public Endpoints (no auth required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/scene-info?parcel=x,y` | Get scene/group info with ban status for a parcel |
| GET | `/bans` | List all bans (scenes, groups, and worlds) |
| GET | `/world-info?world=name` | Get world info with ban status |

#### Backoffice Endpoints (signedFetch + ALLOWED_USERS)

These endpoints require signed requests and the wallet address must be in the `ALLOWED_USERS` environment variable.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/backoffice/scene-groups` | List all scene groups |
| POST | `/backoffice/scene-groups` | Create a new scene group |
| PUT | `/backoffice/scene-groups/:id` | Update a scene group |
| DELETE | `/backoffice/scene-groups/:id` | Delete a scene group |

### Bans (Backoffice)

Content moderation endpoints for banning scenes, scene groups, and worlds.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/backoffice/bans` | List all bans |
| POST | `/backoffice/bans` | Create a ban (group, scene, or world) |
| DELETE | `/backoffice/bans/:id` | Remove a ban |

#### Create Ban Request Body

**Group Ban:**
```json
{
  "groupId": "uuid",
  "reason": "Optional reason"
}
```

**Scene Ban (by parcels):**
```json
{
  "parcels": [{ "x": 0, "y": 0 }, { "x": 1, "y": 0 }],
  "sceneId": "optional-entity-id",
  "reason": "Optional reason"
}
```

**World Ban:**
```json
{
  "worldName": "world-name.dcl.eth",
  "sceneId": "optional-entity-id",
  "reason": "Optional reason"
}
```

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

#### Scene Info Response

For parcels in a scene group:
```json
{
  "ok": true,
  "data": {
    "type": "group",
    "group": { "id": "uuid", "name": "...", "parcels": [...] },
    "isBanned": false,
    "sceneId": null
  }
}
```

For isolated scenes (not in a group):
```json
{
  "ok": true,
  "data": {
    "type": "scene",
    "parcel": { "x": 0, "y": 0 },
    "parcels": [{ "x": 0, "y": 0 }, { "x": 1, "y": 0 }],
    "isBanned": true,
    "sceneId": "bafk..."
  }
}
```

Note: For isolated scenes, `parcels` contains all parcels of the banned scene (from the ban record). If not banned, it defaults to the queried parcel.

#### Bans Response

```json
{
  "ok": true,
  "data": [
    {
      "id": "uuid",
      "groupId": null,
      "worldName": null,
      "parcels": [{ "x": 0, "y": 0 }, { "x": 1, "y": 0 }],
      "sceneId": "bafk...",
      "reason": "Optional reason",
      "createdBy": "0x...",
      "createdAt": 1704067200000
    }
  ]
}
```

Ban types:
- **Scene ban**: `groupId` and `worldName` are null, `parcels` contains the banned parcels
- **Group ban**: `groupId` is set, `parcels` is empty
- **World ban**: `worldName` is set, `parcels` is empty

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

## Dependencies

### Hub Frontend

The hub frontend is served from the npm package:

```bash
npm install @dcl-regenesislabs/mobile-hub
```

This installs the built static files that are served at `/hub/`.

## Database

Uses PostgreSQL with the following tables:

- `scene_groups` - Scene group metadata
- `scene_group_parcels` - Parcel coordinates (PK on x,y ensures one parcel per group)
- `deletion_requests` - Account deletion requests
- `bans` - Ban records (for groups, scenes, or worlds)
- `ban_parcels` - Parcel coordinates for scene bans

Run migrations with:
```bash
npm run migrate
```
