# Class leaderboard API

A small Node service backing the shared leaderboard in `../index.html`. It keeps
scores in Postgres so a whole class sees one board instead of a per-browser one.

No framework and one dependency (`pg`) — the whole thing is ~230 lines of
`index.js`, which is deliberate: this needs to still be maintainable by whoever
inherits the course.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness plus a database round-trip |
| `GET` | `/api/scores?board=<id>&limit=<n>` | Ranked board, solvent players first |
| `POST` | `/api/scores` | Record a finished run |
| `DELETE` | `/api/scores?board=<id>` | Wipe one board — instructor only |

`POST` body:

```json
{ "board": "fall-2026", "name": "Dana", "ni": 640, "cash": 415, "stars": 4, "bust": false }
```

Scores upsert on `(board, lowercased name)` and **only overwrite when the new run
is better** — solvent beats bust, then higher net income. A student who replays
and does worse keeps their best result. The response reports which happened:

```json
{ "board": "fall-2026", "saved": { ... }, "kept_existing": false }
```

`DELETE` needs `Authorization: Bearer <ADMIN_TOKEN>` and only affects the board
named in the query string.

## Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Railway sets this when you attach Postgres |
| `ALLOWED_ORIGINS` | yes | Comma-separated. The GitHub Pages origin, e.g. `https://hughmackey-lsl.github.io`. Origin only — no path, no trailing slash |
| `ADMIN_TOKEN` | yes | Long random string. Without it `DELETE` returns 503 |
| `DATABASE_SSL` | no | Set `true` only if pointing at a public Postgres URL |
| `PORT` | no | Railway injects this |

## Deploying to Railway

1. In your Railway project: **New → GitHub Repo →** this repo.
2. Set the service's **Root Directory** to `server`, so Railway builds this
   folder and not the static page. Start command is `npm start`.
3. **New → Database → Postgres** in the same project.
4. On the API service, add a variable referencing the database:
   `DATABASE_URL = ${{Postgres.DATABASE_URL}}`. The reference form keeps traffic
   on Railway's private network, which is why `DATABASE_SSL` stays unset.
5. Add `ALLOWED_ORIGINS` and `ADMIN_TOKEN`.
6. **Settings → Networking → Generate Domain**, and copy the URL.
7. Put that URL in `API_BASE` in `../index.html` and push. Pages redeploys and
   the board goes live.

The table is created on boot, so there is no migration step. `schema.sql` is the
same DDL if you would rather apply it yourself.

## Running locally

```bash
npm install
DATABASE_URL=postgresql://postgres@127.0.0.1:5432/leaderboard \
ALLOWED_ORIGINS='http://127.0.0.1:4000' \
ADMIN_TOKEN=dev-token \
PORT=3999 npm start
```

Then set `API_BASE='http://127.0.0.1:3999'` in a scratch copy of `index.html`
and serve it on the origin you allowed.

## Notes for whoever maintains this

- **Scores are computed in the browser, so they can be faked.** Anyone who opens
  devtools can POST any number. The server validates types and ranges, not
  honesty. For a graded exercise, treat the board as a talking point rather than
  a gradebook. Closing this properly means moving the simulation server-side,
  which is a much larger change than it sounds.
- **Bump `BOARD_ID` in `index.html` each term.** New cohort, clean board, last
  term's data still intact. Boards are created implicitly on first write.
- **Rate limits are per IP and per route**, in memory. A class usually shares one
  campus NAT address, so the ceilings are loose on purpose — they exist to stop a
  runaway loop, not an attacker. They also reset when the service restarts.
- If you scale past one Railway instance, the rate limiter stops being global
  (each instance counts separately). Nothing else in here holds local state.
