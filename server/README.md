# Class leaderboard API

A small Node service backing the shared leaderboard in `../index.html`. It keeps
scores in Postgres so a whole class sees one board instead of a per-browser one,
and it only accepts scores from students signed in with a school Google account.

Two dependencies (`pg`, `google-auth-library`) and no framework — this needs to
stay maintainable by whoever inherits the course.

## Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/health` | none | Liveness, database round-trip, auth config |
| `GET` | `/api/scores?board=<id>&limit=<n>` | student | Ranked board, solvent players first |
| `POST` | `/api/scores` | student | Record a finished run |
| `DELETE` | `/api/scores?board=<id>` | instructor | Wipe one board |

"student" means a `Authorization: Bearer <google-id-token>` header. The token's
signature is verified against Google's published keys on every request, so the
browser's claim of identity is never taken at face value.

`POST` body — note there is no identity in it, since identity comes from the
verified token:

```json
{ "board": "fall-2026", "name": "Dana", "ni": 640, "cash": 415, "stars": 4, "bust": false }
```

Scores upsert on `(board, google account)` and **only overwrite when the new run
is better** — solvent beats bust, then higher net income. A student who replays
and does worse keeps their best result. The response reports which happened:

```json
{ "board": "fall-2026", "saved": { ... }, "kept_existing": false }
```

`GET` returns display names only. Emails and Google ids are deliberately not in
the response, so students cannot harvest classmates' addresses from the board.
Each row carries `you: true` for the caller's own entry.

## Who counts as a student

A token is accepted only if Google reports a **hosted domain** (`hd`) on the
allow-list. `hd` is set by Google for Workspace accounts and cannot be chosen by
the account holder, which is what makes this a school-account check rather than
an address check — a personal account whose address merely *ends* in `@nyu.edu`
has no `hd` and is refused. Personal gmail.com accounts are refused for the same
reason.

`server/test/auth.test.js` pins this behaviour. Run it with `npm test`.

## Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Railway sets this when you attach Postgres |
| `GOOGLE_CLIENT_ID` | yes | OAuth 2.0 **Web application** client ID. Without it every score request is refused |
| `ALLOWED_ORIGINS` | yes | Comma-separated. The GitHub Pages origin, e.g. `https://hughmackey-lsl.github.io`. Origin only — no path, no trailing slash |
| `ALLOWED_EMAIL_DOMAINS` | no | Comma-separated, defaults to `nyu.edu`. Add subdomains explicitly if students have them, e.g. `nyu.edu,stern.nyu.edu` |
| `ADMIN_EMAILS` | no | Comma-separated instructor addresses allowed to reset a board by signing in |
| `ADMIN_TOKEN` | no | Shared secret alternative for reset. Set at least one of this or `ADMIN_EMAILS`, or reset is disabled |
| `DATABASE_SSL` | no | Set `true` only if pointing at a public Postgres URL |
| `PORT` | no | Railway injects this |

The OAuth **client secret is not needed** and should not be set here. This flow
verifies ID tokens minted in the browser; there is no authorization-code
exchange, which also means no cross-site session cookies to fight with.

## Google Cloud setup

1. In the [Google Cloud console](https://console.cloud.google.com/), create (or
   pick) a project.
2. **APIs & Services → OAuth consent screen.** Choose **Internal** if the
   project lives in NYU's Google Workspace — that alone restricts sign-in to NYU
   accounts, with the domain check here as a second layer. Choose External only
   if Internal is unavailable to you.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID →
   Web application.**
4. Under **Authorized JavaScript origins**, add the exact origin serving the
   page: `https://hughmackey-lsl.github.io`. Origin only — no path. Add
   `http://localhost:4000` too if you want to test locally.
   Leave **Authorized redirect URIs** empty; this flow does not use them.
5. Copy the **Client ID** into `GOOGLE_CLIENT_ID` here and into
   `GOOGLE_CLIENT_ID` in `../index.html`. It is a public identifier, safe to
   commit.

## Deploying to Railway

1. In your Railway project: **New → GitHub Repo →** this repo.
2. Set the service's **Root Directory** to `server`, so Railway builds this
   folder and not the static page. Start command is `npm start`.
3. **New → Database → Postgres** in the same project.
4. On the API service, add a variable referencing the database:
   `DATABASE_URL = ${{Postgres.DATABASE_URL}}`. The reference form keeps traffic
   on Railway's private network, which is why `DATABASE_SSL` stays unset.
5. Add `GOOGLE_CLIENT_ID`, `ALLOWED_ORIGINS`, and `ADMIN_EMAILS` (or
   `ADMIN_TOKEN`).
6. **Settings → Networking → Generate Domain**, and copy the URL.
7. Put that URL in `API_BASE` in `../index.html`, along with the client ID, and
   push. Pages redeploys and the board goes live.

The table is created on boot, so there is no migration step. `schema.sql` is the
same DDL if you would rather apply it yourself.

## Running locally

```bash
npm install
DATABASE_URL=postgresql://postgres@127.0.0.1:5432/leaderboard \
GOOGLE_CLIENT_ID=your-id.apps.googleusercontent.com \
ALLOWED_ORIGINS='http://localhost:4000' \
ADMIN_TOKEN=dev-token \
PORT=3999 npm start
```

Then set `API_BASE` and `GOOGLE_CLIENT_ID` in a scratch copy of `index.html` and
serve it on the origin you allowed. Real sign-in needs a real client ID whose
authorized origins include that address.

## Notes for whoever maintains this

- **Sign-in proves identity, not honesty.** Scores are still computed in the
  browser, so a determined student can post a number they did not earn. What
  changed is that every score is now tied to a verified school account, so it is
  attributable rather than anonymous. Closing the gap properly means moving the
  simulation server-side, which is a much larger change than it sounds.
- **This now stores student data** — email addresses tied to performance. Treat
  the board as an education record: the API requires sign-in even to read it,
  responses omit emails, and you should drop old boards rather than let them
  accumulate. Check your institution's guidance before making a board public.
- **Bump `BOARD_ID` in `index.html` each term.** New cohort, clean board, last
  term's data still intact. Boards are created implicitly on first write.
- **Rate limits are per IP and per route**, in memory. A class usually shares one
  campus NAT address, so the ceilings are loose on purpose — they exist to stop a
  runaway loop, not an attacker. They also reset when the service restarts.
- If you scale past one Railway instance, the rate limiter stops being global
  (each instance counts separately). Nothing else in here holds local state.
