# Mobile Backend-for-Frontend

Backend-for-frontend service for Decentraland mobile applications. Handles account deletion requests, scene groups management, and content moderation (bans).

## API Endpoints

### Scene Groups

Scene groups allow organizing parcels into named collections for the mobile app.

#### Public Endpoints (no auth required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/places?world=name` | Get world group info with ban status |
| GET | `/places?tag=tag1,tag2` | Get groups matching ALL specified tags (AND logic) |
| GET | `/places?parcel=x,y` | Get scene/group info with ban status for a parcel |
| GET | `/bans` | List all bans (scenes, groups, and worlds) |
| GET | `/world-info?world=name` | Get world info with ban status |
| GET | `/scene-info?parcel=x,y` | *Deprecated: use `/places?parcel=x,y`* |

#### Backoffice Endpoints (signedFetch + ALLOWED_USERS)

These endpoints require signed requests and the wallet address must be in the `ALLOWED_USERS` environment variable.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/backoffice/scene-groups` | List all scene groups |
| GET | `/backoffice/scene-groups?tag=featured` | Filter by tag |
| GET | `/backoffice/scene-groups?worldName=name` | Get group by world name |
| POST | `/backoffice/scene-groups` | Create a new scene group |
| PUT | `/backoffice/scene-groups/:id` | Update a scene group |
| DELETE | `/backoffice/scene-groups/:id` | Delete a scene group |
| GET | `/backoffice/tags` | List all tags |
| POST | `/backoffice/tags` | Create a new tag |
| DELETE | `/backoffice/tags/:id` | Delete a tag |

#### Public Tags Endpoint

| Method | Path | Description |
|--------|------|-------------|
| GET | `/tags` | List all tags (name, color, description) |

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

#### Places Endpoint Responses

**World Query (`?world=name`):**
```json
{
  "ok": true,
  "data": {
    "type": "world",
    "group": { "id": "uuid", "name": "world.dcl.eth", "worldName": "world.dcl.eth", "tags": [...] },
    "isBanned": false,
    "banSceneId": null
  }
}
```

**Tag Query (`?tag=featured,allowed_ios`):**

Returns groups matching ALL specified tags (AND logic):
```json
{
  "ok": true,
  "data": [
    {
      "type": "group",
      "group": { "id": "uuid", "name": "...", "parcels": [...], "tags": ["featured", "allowed_ios"] },
      "isBanned": false,
      "banSceneId": null
    },
    {
      "type": "world",
      "group": { "id": "uuid", "name": "world.dcl.eth", "worldName": "world.dcl.eth", "tags": [...] },
      "isBanned": false,
      "banSceneId": null
    }
  ]
}
```

**Parcel Query (`?parcel=x,y`):**

For parcels in a scene group:
```json
{
  "ok": true,
  "data": {
    "type": "group",
    "group": { "id": "uuid", "name": "...", "parcels": [...] },
    "isBanned": false,
    "banSceneId": null
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
    "banSceneId": "bafk..."
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

- `scene_groups` - Scene group metadata (name, description, color, worldName)
- `scene_group_parcels` - Parcel coordinates (PK on x,y ensures one parcel per group)
- `tags` - Normalized tags (name, color, description)
- `scene_group_tags` - Many-to-many relationship between scene groups and tags
- `deletion_requests` - Account deletion requests
- `bans` - Ban records (for groups, scenes, or worlds)
- `ban_parcels` - Parcel coordinates for scene bans

Run migrations with:
```bash
npm run migrate
```
