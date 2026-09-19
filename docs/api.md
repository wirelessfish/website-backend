# API

## GET Routes

### GET `/`

Healthcheck, should return _something_ along with a `200` response.

### GET `/status`

Return server status:

- cpu usage
- cpu temperature
- memory usage
- filesystem usage

### GET `/guestbook`

> [!NOTE]
> Entries with `visible = false` will not be returned.

**Returns:**

```json
{
    comments: [ {}, {}, {}, ... ]
}
```

**Shape of individual comments:**

```ts
interface Comment {
  id: string; // comment UUID
  name: string;
  message: string;
  replies: Comment[];
  site: string | null;
  date: string;
}
```

### GET `/lastfm`

Health check for last.fm connectivity

### GET `/lastfm/proxy/:method`

Proxies request to last.fm, the api key is injected server-side, all query params are forwarded to last.fm.

**Allowed methods:** `user.getRecentTracks`, `user.getInfo`, `user.getTopAlbums`, `user.getTopArtists`, `user.getTopTracks`

To choose which method you're GETting, simply specify it in the path parameter: e.g.: `GET /lastfm/proxy/user.getInfo?user=username`

Should respond with either `400` when a param is missing or a disallowed method is used and

## POST Routes

### POST `/guestbook`

Refer to the [db docs](./db.md) for more details.

| Field     | Type   | Required | Notes                                           |
| --------- | ------ | -------- | ----------------------------------------------- |
| `name`    | string | yes      |                                                 |
| `message` | string | yes      |                                                 |
| `reply`   | string | no       | UUID v4 of the comment being replied to or NULL |
| `website` | string | no       | Must be a valid HTTP/HTTPS URL                  |

Should return `201` on a successful entry, `400` on a fault with either the required fields missing or malformed and `500` for unhandled errors.

### POST `/ntfy`

| Field     | Type   | Required |
| --------- | ------ | -------- |
| `message` | string | yes      |

Returns `200` on a successful send, `400` on a missing `message` field, `503` when ntfy is unavailable and `500` on unhandled errors.
