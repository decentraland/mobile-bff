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

### Wallets & Attestation

Thin proxy in front of Thirdweb's `POST /v1/wallets/sign-message` plus a platform-attestation report endpoint. The proxy forwards the user's `Authorization: Bearer <jwt>` verbatim and injects the server-only `x-secret-key`.

**Attestation gates sign-message**: the client must send the standard `x-attest-*` headers (the same ones consumed by `/attest/check`). A failed verdict returns HTTP 401 with the attestation `code` in the body so the client can decide whether to retry (e.g. re-enroll on `ATTESTATION_IOS_KEY_NOT_REGISTERED`). `/attest/check` always returns 200 and is intended as an analytics report endpoint.

**Threat model — what attestation proves and does not prove**: a passing attestation verdict only proves the request came from a genuine, unmodified iOS/Android build of our app on a non-rooted device. It does not prove _which user_ is signing. The signing user identity comes from the `Authorization: Bearer <jwt>` validated by Thirdweb downstream. If an attacker exfiltrates another user's JWT and pairs it with a legitimate device's attestation headers, they can sign as the JWT owner. The body-binding (App Attest `clientDataHash` and Play Integrity `requestHash`) ensures the headers are tied to the exact request body, but the `Authorization` header is not part of that hash.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/wallets/sign-message` | Thirdweb sign-message proxy. Gated by platform attestation; 401 on failure. |
| POST | `/attest/ios/challenge` | Issue a random one-shot challenge for App Attest enrollment. |
| POST | `/attest/ios/register` | Finish App Attest enrollment: verify the attestation object and persist the leaf public key. |
| POST | `/attest/check` | Verify the platform attestation headers + body. **Always 200**; outcome is in the response body. |

`/attest/check` response shape:

```json
{
  "ok": true,
  "platform": "ios",
  "code": "OK",
  "verdicts": ["MEETS_DEVICE_INTEGRITY"],
  "elapsed_ms": 312
}
```

On failure, `ok=false` and `code` carries one of:

- iOS: `ATTESTATION_IOS_MISSING_HEADERS`, `ATTESTATION_IOS_KEY_NOT_REGISTERED`, `ATTESTATION_IOS_BAD_CBOR`, `ATTESTATION_IOS_BAD_SIGNATURE`, `ATTESTATION_IOS_BAD_ASSERTION`, `ATTESTATION_IOS_COUNTER_REPLAY`
- Android: `ATTESTATION_ANDROID_INVALID_TOKEN`, `ATTESTATION_ANDROID_HASH_MISMATCH`, `ATTESTATION_ANDROID_TOKEN_STALE`, `ATTESTATION_ANDROID_VERDICT_FAILED`, `ATTESTATION_ANDROID_PACKAGE_MISMATCH`
- Generic: `ATTESTATION_UNKNOWN_PLATFORM`, `ATTESTATION_MISSING`

Required request headers (same for `/attest/check`, `/wallets/sign-message`, and what the iOS/Android plugins compute):

- iOS: `x-attest-platform: ios`, `x-attest-key-id`, `x-attest-assertion`, `x-attest-nonce` (all base64url)
- Android: `x-attest-platform: android`, `x-attest-integrity-token` (raw Play Integrity token)

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
| `APP_ATTEST_ENV` | `development` (sandbox-attested keys) or `production` (App Store builds). |
| `PLAY_INTEGRITY_PACKAGE_NAME` | Android package name (must match the verified token). |
| `PLAY_INTEGRITY_REQUIRED_VERDICTS` | Comma-separated `deviceRecognitionVerdict` values that must all be present. |
| `PLAY_INTEGRITY_SA_JSON` | Base64 of the GCP service-account JSON. Generate with `base64 -i sa.json \| tr -d '\n'`. |

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


┌─────────────────────┐       ┌─────────────────────┐
│  attest_challenges  │       │     attest_keys     │
├─────────────────────┤       ├─────────────────────┤
│ challenge   (PK)    │       │ key_id      (PK)    │
│ challenge_bytes     │       │ public_key_pem      │
│ expires_at          │       │ counter   bigint    │
└─────────────────────┘       │ created_at          │
                              │ last_used_at        │
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
- `attest_challenges` - Short-lived (5 min TTL) one-shot challenges for App Attest enrollment
- `attest_keys` - Long-lived iOS App Attest registrations (one row per install, monotonic counter for replay detection)
