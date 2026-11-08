# Daybook

A Notion-style daily notes app. It works offline, syncs across your devices, and installs on desktop and phone.

- **Web app** (`web/`): React, TipTap editor, IndexedDB (Dexie). Every edit is saved on the device first, then synced in the background.
- **Server** (`server/`): one Rust binary (axum) with one SQLite file. It serves the web app and the API.
- **Accounts**: invite-only. There is no sign-up page.

```
Browser (installed web app)                      One container
  React + TipTap                                   daybook (Rust)
  IndexedDB: pages, images        POST /api/sync    SQLite (WAL) + files/ on /data
  service worker: offline shell   ───────────────▶  Litestream → object storage (optional)
```

## Run it locally

You need Node 22+ and Rust (or just Docker).

```bash
# 1. build the web app (the server embeds it)
cd web && npm install && npm run build && cd ..

# 2. start the server
cd server && cargo run --release        # http://localhost:8080

# 3. invite yourself (in another terminal, same folder)
cargo run --release -- invite you@example.com
# open the printed link, choose a password, sign in
```

With Docker only: `docker build -t daybook . && docker run -p 8080:8080 -v daybook-data:/data daybook`, then
`docker exec <container> daybook invite you@example.com`.

Development with hot reload: run the server as above, then `cd web && npm run dev` (Vite proxies `/api` and `/files` to port 8080).

## Using it

| Do this | How |
|---|---|
| Open today's note | **Today** in the sidebar. It has Tasks and Notes sections. Use ‹ › to move between days |
| Add a block | Type `/`. Or use markdown shortcuts: `# `, `- `, `[] `, `> `, ``` ``` ```, `---` |
| Format text | Select text, then use the bubble menu. `Ctrl+B` / `Ctrl+I` work too |
| Reorder blocks | Hover a block and drag the `⋮⋮` handle |
| Reorder or nest pages | Drag a page in the sidebar. Drop on the top or bottom edge to reorder, in the middle to nest |
| Images and files | Paste or drop an image, or use `/image` and `/file` (10 MB limit) |
| Database | **New database** in the sidebar. Rows are pages. Click a column title to sort |
| Back up | **Backup** downloads JSON. **Restore** loads it. A page can also be exported as Markdown |

## Accounts

```bash
daybook invite person@example.com     # prints a one-time link to set a password
daybook invite person@example.com     # run again to reset a forgotten password
```

Sign-in is rate limited (5 failures per email, then a 15 minute wait).

## Deploy on Fly.io (free `*.fly.dev` address)

Check Fly's current free allowance first; it changes.

```bash
fly launch --no-deploy --copy-config         # pick a unique app name, then edit fly.toml to match
fly volumes create daybook_data --size 1
fly deploy
fly ssh console -C "daybook invite you@example.com"
```

Set `DAYBOOK_PUBLIC_URL` in `fly.toml` to your `https://<app>.fly.dev` address so invite links and secure cookies are right.

### Backup with Litestream (recommended)

Create a bucket (Cloudflare R2, S3, Backblaze B2), then:

```bash
fly secrets set LITESTREAM_REPLICA_URL=s3://your-bucket/daybook \
  LITESTREAM_ACCESS_KEY_ID=... LITESTREAM_SECRET_ACCESS_KEY=...
```

On start, if there is no database yet, the container restores the latest copy from the bucket, then replicates continuously.
**Test a restore once** (delete the volume's `daybook.db` on a scratch app and start it) before trusting it.
Uploaded images live in `/data/files` and are not covered by Litestream; back that folder up separately or keep the volume snapshots on.

## How sync works

- Each page is one row. The client keeps a `dirty` flag per page and pushes dirty pages to `POST /api/sync` along with the last `seq` it has seen.
- The server stamps every accepted change with a global counter (`seq`), so device clocks never matter. The reply contains everything with a higher `seq`.
- **Conflicts: the last push to arrive wins.** The replaced version is kept in `page_history` (at most 20 per page; a stale write always keeps the old version).
- Two devices that each create today's note while offline are merged into one, and nothing is dropped.
- Images are stored by SHA-256 on the device, uploaded when online, and fetched on demand on other devices.

## Tests

```bash
cd server && cargo test        # sync, isolation, merge, history
cd web && npm test             # helpers and Markdown export
docker build -t daybook:dev . && sh e2e/run.sh   # 11 browser tests (Playwright in Docker): sign-in, editor, two devices,
                                                 # offline sync, account isolation, images, databases, PWA offline start, phone layout, drag and drop
```

## Not built yet

- Board and calendar views for databases (table view only).
- Live collaboration and shared pages.
- Desktop wrapper (the installed web app covers desktop).
