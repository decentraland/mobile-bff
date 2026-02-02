# Proxy APIs

This BFF provides cached proxy endpoints for Decentraland's Destinations and Events APIs with tag-based filtering capabilities. These endpoints allow mobile clients to fetch curated content based on internal tags (e.g., `allowed_ios`, `featured`).

## Overview

Both endpoints operate in two modes:

1. **Tag Mode**: When the `tag` parameter is provided, the endpoint filters results to only include places that match the specified tags in the internal database
2. **Proxy Mode**: When no `tag` parameter is provided, requests are forwarded directly to the upstream API

All responses are cached for 2 hours (configurable) using a two-level caching strategy for optimal performance.

---

## GET /destinations

> Fetch destinations (places/worlds) from the Decentraland Places API with optional tag-based filtering.
>
> **Upstream API**: `https://places.decentraland.org/api/destinations`
>
> **Common Use Cases:**
> - `GET /destinations` - Get all destinations (proxied)
> - `GET /destinations?tag=allowed_ios` - Get destinations allowed on iOS
> - `GET /destinations?tag=allowed_ios,featured` - Get destinations matching ALL tags
> - `GET /destinations?tag=featured&search=museum` - Tag filtering with search

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tag` | string | No | Comma-separated list of tags to filter by. When provided, only returns destinations for places matching ALL specified tags (AND logic). |
| `search` | string | No | Full-text search query (passed to upstream API) |
| `limit` | integer | No | Maximum number of results to return (passed to upstream API) |
| `offset` | integer | No | Number of results to skip for pagination (passed to upstream API) |
| `order_by` | string | No | Sort order: `most_active`, `like_score`, etc. (passed to upstream API) |
| `only_places` | boolean | No | When `true`, only return Genesis City scenes (passed to upstream API) |
| `only_worlds` | boolean | No | When `true`, only return worlds (passed to upstream API) |
| `pointer` | string[] | No | Filter by specific coordinates, e.g., `pointer=0,0` (passed to upstream API) |
| `world_names` | string[] | No | Filter by specific world names (passed to upstream API) |

### Response

```json
{
  "ok": true,
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "title": "Decentraland Museum",
      "description": "A virtual museum showcasing digital art",
      "base_position": "52,-32",
      "contact_name": "DCL Foundation",
      "world_name": null,
      "highlighted": true,
      "favorites": 1250,
      "likes": 890,
      "dislikes": 12,
      "user_count": 45,
      "deployed_at": "2024-01-15T10:30:00.000Z",
      "updated_at": "2024-06-20T14:22:00.000Z"
    }
  ],
  "total": 1
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `ok` | boolean | Whether the request succeeded |
| `data` | array | Array of destination objects |
| `total` | integer | Total number of results returned |

### Destination Object

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (UUID) |
| `title` | string | Display name of the destination |
| `description` | string | Description text |
| `base_position` | string | Base coordinates for scenes (e.g., `"52,-32"`), null for worlds |
| `world_name` | string | World name for worlds (e.g., `"my-world.dcl.eth"`), null for scenes |
| `highlighted` | boolean | Whether the destination is highlighted/promoted |
| `favorites` | integer | Number of users who favorited this destination |
| `likes` | integer | Number of likes |
| `dislikes` | integer | Number of dislikes |
| `user_count` | integer | Current number of users at this destination |
| `deployed_at` | string | ISO 8601 timestamp of deployment |
| `updated_at` | string | ISO 8601 timestamp of last update |

### Examples

**Get all destinations (proxy mode):**
```bash
curl "https://api.example.com/destinations"
```

**Get iOS-allowed destinations:**
```bash
curl "https://api.example.com/destinations?tag=allowed_ios"
```

**Get featured iOS destinations with search:**
```bash
curl "https://api.example.com/destinations?tag=allowed_ios,featured&search=art&limit=10"
```

**Get destinations sorted by activity:**
```bash
curl "https://api.example.com/destinations?tag=allowed_ios&order_by=most_active"
```

### Error Responses

| Status | Description |
|--------|-------------|
| 400 | Invalid tag parameter (whitespace-only) |
| 500 | Internal server error |

```json
{
  "ok": false,
  "error": "Invalid tag parameter"
}
```

---

## GET /events

> Fetch events from the Decentraland Events API with optional tag-based filtering.
>
> **Upstream API**: `https://events.decentraland.org/api/events`
>
> **Common Use Cases:**
> - `GET /events` - Get all events (proxied)
> - `GET /events?tag=allowed_ios` - Get events at iOS-allowed places
> - `GET /events?tag=featured&search=music` - Tag filtering with search
> - `GET /events?search=party` - Search events (proxy mode)

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tag` | string | No | Comma-separated list of tags to filter by. When provided, only returns events at places matching ALL specified tags (AND logic). |
| `search` | string | No | Full-text search query (minimum 3 characters). Searches event names and descriptions. |

### Response

```json
{
  "ok": true,
  "data": [
    {
      "id": "event-123",
      "name": "Live Music Night",
      "description": "Join us for an evening of live performances",
      "image": "https://events.decentraland.org/images/event-123.jpg",
      "start_at": "2024-07-15T20:00:00.000Z",
      "finish_at": "2024-07-15T23:00:00.000Z",
      "world": false,
      "server": "decentraland.org",
      "position": [52, -32],
      "user_count": 120,
      "total_attendees": 450,
      "highlighted": true,
      "trending": true,
      "approved": true
    }
  ],
  "total": 1
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `ok` | boolean | Whether the request succeeded |
| `data` | array | Array of event objects |
| `total` | integer | Total number of results returned |

### Event Object

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier |
| `name` | string | Event name |
| `description` | string | Event description |
| `image` | string | URL to event image |
| `start_at` | string | ISO 8601 timestamp of event start |
| `finish_at` | string | ISO 8601 timestamp of event end |
| `world` | boolean | Whether the event is in a world (vs Genesis City) |
| `server` | string | Server hosting the event |
| `position` | array | Coordinates `[x, y]` for Genesis City events |
| `user_count` | integer | Current number of attendees |
| `total_attendees` | integer | Total RSVPs/interested users |
| `highlighted` | boolean | Whether the event is highlighted |
| `trending` | boolean | Whether the event is trending |
| `approved` | boolean | Whether the event is approved |

### Examples

**Get all events (proxy mode):**
```bash
curl "https://api.example.com/events"
```

**Get events at iOS-allowed places:**
```bash
curl "https://api.example.com/events?tag=allowed_ios"
```

**Search for music events at featured places:**
```bash
curl "https://api.example.com/events?tag=featured&search=music"
```

**Search all events:**
```bash
curl "https://api.example.com/events?search=party"
```

### Error Responses

| Status | Description |
|--------|-------------|
| 400 | Invalid tag parameter (whitespace-only) |
| 500 | Internal server error |

```json
{
  "ok": false,
  "error": "Invalid tag parameter"
}
```

---

## Tag-Based Filtering

Both endpoints support filtering by internal tags stored in this BFF's database. Tags are used to categorize places for different purposes.

### How It Works

1. When a `tag` parameter is provided, the BFF queries its internal database for places matching ALL specified tags
2. For `/destinations`: Fetches destinations using `pointer` (for scenes) and `world_names` (for worlds) parameters
3. For `/events`: Fetches events using `positions[]` (for scenes) and `world_names[]` (for worlds) parameters
4. Results are deduplicated and cached

### Common Tags

| Tag | Description |
|-----|-------------|
| `allowed_ios` | Places approved for iOS app |
| `featured` | Highlighted/promoted places |

### Multiple Tags (AND Logic)

When multiple tags are specified (comma-separated), only places matching **all** tags are returned:

```bash
# Returns only places that are BOTH allowed_ios AND featured
curl "https://api.example.com/destinations?tag=allowed_ios,featured"
```

---

## Caching

Both endpoints implement a two-level caching strategy:

1. **Query-level cache**: The full query result (list of IDs) is cached
2. **Item-level cache**: Individual destinations/events are cached by ID

### Cache Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `DESTINATIONS_CACHE_TTL_MS` | `7200000` (2 hours) | Cache TTL for destinations |
| `EVENTS_CACHE_TTL_MS` | `7200000` (2 hours) | Cache TTL for events |

### Benefits

- Repeated queries return cached results instantly
- Overlapping queries share cached items
- Individual items can be reused across different queries

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DESTINATIONS_API_URL` | `https://places.decentraland.org/api/destinations` | Upstream destinations API URL |
| `DESTINATIONS_CACHE_TTL_MS` | `7200000` | Cache TTL in milliseconds |
| `EVENTS_API_URL` | `https://events.decentraland.org/api/events` | Upstream events API URL |
| `EVENTS_CACHE_TTL_MS` | `7200000` | Cache TTL in milliseconds |
