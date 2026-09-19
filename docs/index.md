# Docs

## Env vars

- `NTFY_NOTIFICATION` URL for public ntfy notifications
- `NTFY_BACKEND` secret URL for private ntfy notifications (new guestbook entry, errors, status updates, etc...)
- `TUNNEL_TOKEN` cloudflare tunnel token
- `LASTFM_KEY` last.fm api key
- `DB_PATH` path of the db file (eg.: `./data/db.sqlite`)
- `BACKUP_DIR` directory where database backups are kept
- `BACKUPS_KEPT` backups kept, literally
- `DEV_ENV` when `true` disables caching and rate limits

[Database docs](./db.md)

[API docs](./api.md)
