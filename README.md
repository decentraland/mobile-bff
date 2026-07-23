# Mobile Backend-for-Frontend

Backend-for-frontend service for Decentraland mobile applications. Handles account deletion requests, places management, and content moderation (bans).


## API Endpoints

### Places

Places allow organizing scenes and worlds into named collections for the mobile app.

#### Public Endpoints (no auth required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/places?world=name` | Get world place info with ban status |
| GET | `/places?tag=tag1,tag2` | Get places matching ALL specified tags (AND logic) |
| GET | `/places?parcel=x,y` | Get scene/place info with ban status for a parcel |
| GET | `/bans` | List all bans (scenes, places, and worlds) |
| GET | `/tags` | List all tags (name, color, description) |

#### Backoffice Endpoints (signedFetch + ALLOWED_USERS)

These endpoints require signed requests and the wallet address must be in the `ALLOWED_USERS` environment variable.

##### Place Groups

| Method | Path | Description |
|--------|------|-------------|
| GET | `/backoffice/place-groups` | List all place groups |
| GET | `/backoffice/place-groups?tag=featured` | Filter by tag |
| POST | `/backoffice/place-groups` | Create a new place group |
| PUT | `/backoffice/place-groups/:id` | Update a place group |
| DELETE | `/backoffice/place-groups/:id` | Delete a place group |

##### Places

| Method | Path | Description |
|--------|------|-------------|
| GET | `/backoffice/places` | List all places |
| GET | `/backoffice/places?groupId=uuid` | Filter places by group |
| POST | `/backoffice/places` | Create a new place |
| PUT | `/backoffice/places/:id` | Update a place |
| DELETE | `/backoffice/places/:id` | Delete a place |

##### Tags

| Method | Path | Description |
|--------|------|-------------|
| GET | `/backoffice/tags` | List all tags |
| POST | `/backoffice/tags` | Create a new tag |
| DELETE | `/backoffice/tags/:id` | Delete a tag |

##### Bans

| Method | Path | Description |
|--------|------|-------------|
| GET | `/backoffice/bans` | List all bans |
| POST | `/backoffice/bans` | Create a ban (place, group, or world) |
| DELETE | `/backoffice/bans/:id` | Remove a ban |

### Feature Flags

Runtime toggles consumed by the mobile clients. The flag names match the godot-explorer
deep-link query params (e.g. `pulse`, `dual-channel`), so the explorer can adopt this
endpoint as its remote flags source. `pulse` and `dual-channel` are seeded by migration;
additional flags can be created and managed at runtime through the backoffice endpoints
(or the mobile-hub admin UI).

#### Public

| Method | Path | Description |
|--------|------|-------------|
| GET | `/feature-flags` | Get all feature flags as a `{ name: boolean }` map |

```json
{ "ok": true, "data": { "flags": { "pulse": false, "dual-channel": true } } }
```

#### Backoffice (signedFetch + ALLOWED_USERS)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/backoffice/feature-flags` | List flags with description and audit info (`updatedAt`, `updatedBy`) |
| POST | `/backoffice/feature-flags` | Create a flag: `{ "name": "shiny-thing", "enabled": false, "description": "..." }` |
| PUT | `/backoffice/feature-flags/:name` | Update `enabled` and/or `description` (pass `null` to clear it) |
| DELETE | `/backoffice/feature-flags/:name` | Delete a flag |

Flag names must be kebab-case (`^[a-z0-9]+(-[a-z0-9]+)*$`, max 64 chars — enforced by the
handlers and by a CHECK constraint) so every flag can double as a deep-link param.
Duplicate names are rejected with `409`; every change records which wallet made it.

### Request/Response Schemas

#### Place Group Schema

```json
{
  "id": "uuid",
  "name": "Group Name",
  "description": "Optional description",
  "color": "#FF6B6B",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

#### Place Schema

```json
{
  "id": "uuid",
  "type": "scene",
  "name": "Place Name",
  "basePosition": "0,0",
  "positions": ["0,0", "1,0", "0,1"],
  "worldName": null,
  "sceneId": "bafk...",
  "groupId": "uuid",
  "tags": ["featured", "allowed_ios"],
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

For worlds:
```json
{
  "id": "uuid",
  "type": "world",
  "name": "World Name",
  "basePosition": null,
  "positions": [],
  "worldName": "world.dcl.eth",
  "sceneId": null,
  "groupId": "uuid",
  "tags": ["featured"],
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

#### Create Place Request

**Scene:**
```json
{
  "type": "scene",
  "name": "My Scene",
  "basePosition": "0,0",
  "positions": ["0,0", "1,0"],
  "sceneId": "bafk...",
  "groupId": "uuid",
  "tags": ["featured"]
}
```

**World:**
```json
{
  "type": "world",
  "name": "My World",
  "worldName": "world.dcl.eth",
  "groupId": "uuid",
  "tags": ["featured"]
}
```

#### Places Endpoint Responses

**World Query (`?world=name`):**
```json
{
  "ok": true,
  "data": {
    "id": "uuid",
    "type": "world",
    "name": "World Name",
    "worldName": "world.dcl.eth",
    "tags": ["featured"],
    "isBanned": false,
    "banSceneId": null
  }
}
```

**Tag Query (`?tag=featured,allowed_ios`):**

Returns places matching ALL specified tags (AND logic):
```json
{
  "ok": true,
  "data": [
    {
      "id": "uuid",
      "type": "scene",
      "name": "Scene Name",
      "basePosition": "0,0",
      "positions": ["0,0", "1,0"],
      "tags": ["featured", "allowed_ios"],
      "isBanned": false,
      "banSceneId": null
    },
    {
      "id": "uuid",
      "type": "world",
      "name": "World Name",
      "worldName": "world.dcl.eth",
      "tags": ["featured", "allowed_ios"],
      "isBanned": false,
      "banSceneId": null
    }
  ]
}
```

**Parcel Query (`?parcel=x,y`):**

For parcels in a registered place:
```json
{
  "ok": true,
  "data": {
    "id": "uuid",
    "type": "scene",
    "name": "Scene Name",
    "basePosition": "0,0",
    "positions": ["0,0", "1,0"],
    "tags": ["featured"],
    "isBanned": false,
    "banSceneId": null
  }
}
```

For isolated scenes (not registered as a place):
```json
{
  "ok": true,
  "data": {
    "type": "scene",
    "position": "0,0",
    "positions": ["0,0", "1,0"],
    "isBanned": true,
    "banSceneId": "bafk..."
  }
}
```

Note: For isolated scenes, `positions` contains all positions of the banned scene (from the ban record). If not banned, it defaults to the queried position.

#### Create Ban Request

**Place Ban:**
```json
{
  "placeId": "uuid",
  "reason": "Optional reason"
}
```

**Group Ban:**
```json
{
  "groupId": "uuid",
  "reason": "Optional reason"
}
```

**Scene Ban (by positions):**
```json
{
  "positions": ["0,0", "1,0"],
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

#### Bans Response

```json
{
  "ok": true,
  "data": [
    {
      "id": "uuid",
      "groupId": null,
      "placeId": null,
      "worldName": null,
      "positions": ["0,0", "1,0"],
      "sceneId": "bafk...",
      "reason": "Optional reason",
      "createdBy": "0x...",
      "createdAt": 1704067200000
    }
  ]
}
```

Ban types:
- **Scene ban**: `groupId`, `placeId`, and `worldName` are null, `positions` contains the banned positions
- **Place ban**: `placeId` is set, `positions` is empty
- **Group ban**: `groupId` is set, `positions` is empty
- **World ban**: `worldName` is set, `positions` is empty

### Account Deletion

| Method | Path | Description |
|--------|------|-------------|
| POST | `/deletion` | Request account deletion (signedFetch) |
| GET | `/deletion` | Get deletion request status (signedFetch) |
| DELETE | `/deletion` | Cancel deletion request (signedFetch) |

`POST /deletion` records the request in the `deletion_requests` table and responds immediately. In the background it dispatches a Magic Link wallet deletion (`POST https://api.magic.link/v1/admin/user/deletion/request`) for the requesting address, then sends a Slack notification with the outcome. `MAGIC_SECRET_KEY` is required — the service will fail to boot without it.

Slack-message behavior, by Magic outcome:
- `processed` — confirmation message with the user's email (auto-deleted, no manual work needed).
- `error` — alert message; manual deletion still required.
- `not_found` — original "deletion requested" message with no Magic mention (non-Magic users follow the existing manual flow, e.g., thirdweb).

Response:
```json
{
  "ok": true,
  "data": {
    "userAddress": "0x...",
    "requestedAt": "2026-05-15T00:00:00.000Z",
    "status": "pending",
    "magic": { "status": "queued" }
  }
}
```

### Wallets & Attestation

Thin proxy in front of Thirdweb's `POST /v1/wallets/sign-message` plus a platform-attestation gate that issues a short-lived session token. The proxy forwards the user's `Authorization: Bearer <jwt>` verbatim and injects the server-only `x-secret-key`.

**Flow**: the client runs platform attestation once and exchanges it for a session token at `POST /attest/session`. Subsequent `/wallets/sign-message` calls send only `x-attest-session: <token>` — no per-request attestation, no per-request Play Integrity / App Attest verification. A failed verdict at session-issuance returns HTTP 401 with the attestation `code` in the body so the client can decide how to retry.

The server keeps **no attestation state**. Challenges are HMAC-signed (5 min TTL, stateless). iOS clients generate a fresh App Attest key per session (Secure Enclave, ~200ms). Session tokens are HMAC-signed too; rotating `ATTESTATION_SESSION_SECRET` invalidates every outstanding token.

**Threat model — what attestation proves and does not prove**: a passing attestation verdict only proves the request came from a genuine, unmodified iOS/Android build of our app on a non-rooted device. It does not prove _which user_ is signing. The signing user identity comes from the `Authorization: Bearer <jwt>` validated by Thirdweb downstream. If an attacker exfiltrates another user's JWT and pairs it with a valid session token (or a legitimate device's headers at session-issuance), they can sign as the JWT owner. The session token is the long-lived (48h default) credential; treat it as a bearer secret.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/attest/ios/challenge` | Mint a stateless HMAC-signed challenge for iOS App Attest. Returns `{ challenge, expires_at }`. |
| POST | `/attest/session` | Verify the platform attestation and return `{ token, expires_at }`. 401 on failure with the attestation `code` in the body. |
| POST | `/wallets/sign-message` | Thirdweb sign-message proxy. Requires `x-attest-session`; returns 401 if the token is missing, malformed, or expired. |

`POST /attest/session` request shape:

- iOS: `x-attest-platform: ios` header + JSON body `{ key_id, attestation_object, challenge }` (all base64url; `challenge` is what `/attest/ios/challenge` returned).
- Android: `x-attest-platform: android` header + `x-attest-integrity-token: <raw Play Integrity token>`. The raw request body is the nonce the token was bound to via `requestHash`.

On failure, `ok=false` and `code` carries one of:

- iOS: `ATTESTATION_IOS_BAD_BODY`, `ATTESTATION_IOS_BAD_CHALLENGE`, `ATTESTATION_IOS_BAD_CBOR`, `ATTESTATION_IOS_BAD_ASSERTION`
- Android: `ATTESTATION_ANDROID_INVALID_TOKEN`, `ATTESTATION_ANDROID_HASH_MISMATCH`, `ATTESTATION_ANDROID_TOKEN_STALE`, `ATTESTATION_ANDROID_VERDICT_FAILED`, `ATTESTATION_ANDROID_PACKAGE_MISMATCH`
- Generic: `ATTESTATION_UNKNOWN_PLATFORM`, `ATTESTATION_MISSING`

Session-token errors at `/wallets/sign-message` carry `ATTESTATION_SESSION_MISSING`, `ATTESTATION_SESSION_MALFORMED`, `ATTESTATION_SESSION_BAD_SIGNATURE`, `ATTESTATION_SESSION_EXPIRED`, or `ATTESTATION_SESSION_BAD_VERSION`.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PG_COMPONENT_PSQL_*` | PostgreSQL connection settings |
| `ALLOWED_USERS` | Comma-separated wallet addresses allowed to use backoffice endpoints |
| `SLACK_WEBHOOK_URL` | Webhook for deletion request notifications |
| `THIRDWEB_SECRET_KEY` | Server-only Thirdweb API key for the sign-message proxy. |
| `THIRDWEB_CLIENT_ID` | Thirdweb client id (sent alongside the secret key). |
| `THIRDWEB_API_BASE_URL` | Optional upstream override; defaults to the public Thirdweb API. |
| `APP_ATTEST_APP_ID` | Apple appId for the iOS app, in the form `<TEAM_ID>.<bundle.id>`. |
| `APP_ATTEST_ENV` | `development` (sandbox-attested keys only), `production` (App Store / TestFlight only), or `any` (accept either AAGUID). If unset: defaults to `production` when `ENV=prd`, otherwise `any` — so a single non-prod backend serves both local Xcode dev builds and TestFlight-distributed builds without per-deploy config. |
| `PLAY_INTEGRITY_PACKAGE_NAME` | Android package name (must match the verified token). |
| `PLAY_INTEGRITY_REQUIRED_VERDICTS` | Comma-separated `deviceRecognitionVerdict` values that must all be present. |
| `PLAY_INTEGRITY_SA_JSON` | Base64 of the GCP service-account JSON. Generate with `base64 -i sa.json \| tr -d '\n'`. |
| `ATTESTATION_SESSION_SECRET` | 256-bit secret. HMAC key for both session tokens (issued by `/attest/session`) and stateless challenges (issued by `/attest/ios/challenge`). Generate with `openssl rand -base64 32`. Rotating it invalidates every outstanding session token and challenge. |
| `ATTESTATION_SESSION_TTL_MS` | Session-token TTL in ms. Default 48h. Longer TTL = fewer attestations but wider replay window if a token leaks. |
| `MAGIC_SECRET_KEY` | **Required.** Magic Link admin secret used by `POST /deletion` to delete the user's Magic wallet. Boot fails if unset. |
| `MAGIC_API_BASE` | Optional override for the Magic API base URL (default: `https://api.magic.link`). |

## Database

Uses PostgreSQL. Run migrations with:
```bash
npm run migrate
```

### Schema Diagram

```
┌─────────────────────┐
│    place_groups     │
├─────────────────────┤
│ id          (PK)    │
│ name        varchar │
│ description text    │
│ color       varchar │
│ created_at          │
│ updated_at          │
└─────────────────────┘
         │
         │ 1:N (group_id)
         ▼
┌─────────────────────┐       ┌─────────────────────┐
│       places        │       │        tags         │
├─────────────────────┤       ├─────────────────────┤
│ id          (PK)    │       │ id          (PK)    │
│ type   scene/world  │       │ name        varchar │
│ name        varchar │       │ description text    │
│ base_position "x,y" │       │ created_at          │
│ world_name  varchar │       └─────────────────────┘
│ scene_id    varchar │                │
│ group_id    (FK) ───┼────────────────┤
│ created_at          │                │
│ updated_at          │                │
└─────────────────────┘                │
    │           │                      │
    │ 1:N       │ M:N                  │
    │           ▼                      │
    │   ┌─────────────────────┐       │
    │   │    place_tags       │◄──────┘
    │   ├─────────────────────┤
    │   │ place_id   (FK, PK) │
    │   │ tag_id     (FK, PK) │
    │   │ created_at          │
    │   └─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  place_positions    │
├─────────────────────┤
│ place_id    (FK)    │
│ position (PK) "x,y" │
└─────────────────────┘


┌─────────────────────┐       ┌─────────────────────┐
│        bans         │       │   ban_positions     │
├─────────────────────┤       ├─────────────────────┤
│ id          (PK)    │──1:N─▶│ ban_id   (FK, PK)   │
│ group_id    (FK)────┼──▶ place_groups            │
│ place_id    (FK)────┼──▶ places    │ position (PK) "x,y" │
│ world_name  varchar │       └─────────────────────┘
│ scene_id    varchar │
│ reason      text    │
│ created_by  varchar │
│ created_at          │
└─────────────────────┘


┌─────────────────────┐
│ deletion_requests   │
├─────────────────────┤
│ address      (PK)   │
│ requested_at        │
│ status              │
└─────────────────────┘


```

### Tables

- `place_groups` - Group metadata (name, description, color)
- `places` - Individual places (scenes or worlds) with optional group assignment
- `place_positions` - Parcel coordinates for scene places (PK on position ensures one place per parcel)
- `tags` - Normalized tags (name, color, description)
- `place_tags` - Many-to-many relationship between places and tags
- `bans` - Ban records (for places, groups, scenes, or worlds)
- `ban_positions` - Parcel coordinates for scene bans
- `deletion_requests` - Account deletion requests

The attestation flow is stateless — challenges are HMAC-signed and session tokens are HMAC-signed, so no DB tables back it.
