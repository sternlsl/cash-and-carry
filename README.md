# Stern Cash & Carry — The Profit vs. Cash Challenge

A single-file interactive scenario for an introductory financial accounting course.
Students run a small retailer for four quarters and learn — by playing — why
**net income and cash are not the same thing**.

## Status

**Live and in use.** The game is at
<https://sternlsl.github.io/cash-and-carry/>, with the leaderboard API on
Railway and Google sign-in verified end to end against a real NYU account.

Current board: `fall-2026`. Allowed sign-in domain: `nyu.edu`.

Jump to [Architecture](#architecture) for how the two halves fit together, or
[Running a new term](#running-a-new-term) for the per-term checklist.

## Design notes

Why the simulation is tuned the way it is. "The original" below refers to the
first draft of the scenario, kept here because the reasoning still explains most
of the numbers in `index.html`.

**Economic rebalance (v2)** — tuned via Monte Carlo (30k games/strategy) so solvency
is a real constraint, not a theoretical one:
- Thin margins: sell $30 / cost $20 (COGS ≈ 67% of revenue, realistic for retail).
  Starting cash $200. The old $50/$20 tuning produced a 0% bust rate under every
  strategy and ~$1,150 ending cash — solvency never bound.
- Inventory is **paid for at order time**: the order slider caps at what your cash
  covers, so "can I afford to stock the forecast?" binds in ~1–3 quarters per game.
- Demand arc ends in a Q4 surge (10–22 units) that deliberately exceeds unleveraged
  cash capacity — chasing it requires the Q3-unlocked working-capital tools.
- Supplier credit costs $2/unit (~10%/quarter cost of trade credit — a good
  discussion hook: that's ~40% annualized).
- A **year-end close** settles every IOU (collect all AR, pay all AP) before the
  final score. Over-leveraged players can die *at the close* despite four
  profitable quarters — the game's sharpest lesson. Simulated bust rates: 0% for
  cautious play, ~1–3% for aggressive leveraged play, higher for greed; risk-takers
  earn more on average, so the leaderboard rewards smart tool use.

**Game mechanics**
- Demand is now a *forecast range* before you order; the actual number is revealed
  only after the order is locked. This creates the real inventory tension
  (stockout vs. cash tied up on the shelf) that the original lacked, since it
  showed exact demand up front.
- A risk meter on the order screen shows best/worst-case net income and ending
  cash. Plans that survive only on high demand are flagged as a gamble (allowed);
  plans that fail even in the best case are blocked.
- One **insight check** per quarter — a multiple-choice question generated from the
  student's own numbers. Answering correctly on the first try earns a CFO star.
  The financial statements unlock after answering, and stars appear on the
  leaderboard next to net income.
- Going bust delivers the punchline explicitly: "your books show a profit; you
  still died." Bust players sort below solvent players on the leaderboard.

**Concept reinforcement**
- Results lead with twin scorecards: *net income this quarter* vs. *cash change
  this quarter*, plus the gap between them.
- A full **cash flow walk** (direct method) joins the income statement and balance
  sheet each quarter, and a "bridging the gap" panel reconciles net income to the
  cash change (indirect method) — it always ties to the dollar.
- The balance sheet now articulates: equity = $250 invested + cumulative net
  income, with an explicit "✓ balances" check.
- Final screen charts cumulative net income vs. cash balance across the year —
  the two lines visibly diverge and cross.

**Accounting fixes**
- Accounts receivable from credit sales are now actually collected the following
  quarter (the original recorded AR but never turned it into cash).
- The per-unit premium for paying suppliers late ($2/unit) is now recorded as a
  supplier-credit fee on the income statement (the original silently dropped it,
  so the statements didn't articulate).

**UX / branding**
- NYU violet (#57068C) chrome, Public Sans, quarter progress stepper, mobile
  responsive, accessible chart with a table view.

## Architecture

This is a **split deployment**, which is the one thing to understand before
changing anything:

| Piece | Where | What it does |
| --- | --- | --- |
| `index.html` | GitHub Pages, from `main` | The entire game — one static file, no build step |
| [`server/`](server/) | Railway (Node + Postgres) | Leaderboard API only; never serves the page |

The browser calls Railway directly. The two halves are joined by nothing but the
`API_BASE` URL in the page and `ALLOWED_ORIGINS` on the server — if either is
wrong, the board silently falls back to per-device scores. See
[`server/README.md`](server/README.md) for deploy steps and environment
variables.

**Pages builds from `main`.** A config change on a feature branch will not go
live, however green the branch looks.

## Configuration

Students sign in with their NYU Google account, so each student appears once and
under a consistent identity. Three constants near the top of the script block in
`index.html` control the wiring:

```js
const API_BASE='https://your-service.up.railway.app';        // no trailing slash
const BOARD_ID='fall-2026';                                  // bump each term
const GOOGLE_CLIENT_ID='xxxx.apps.googleusercontent.com';    // public, safe to commit
```

Leaving `API_BASE` empty runs the game fully offline: no sign-in, no Google
script loaded at all, and the board falls back to this browser's `localStorage` —
the original behaviour. That fallback is also what students see if the backend is
unreachable mid-class: the page keeps working and says so, rather than showing an
empty leaderboard.

`BOARD_ID` separates cohorts. Bumping it each term starts a clean board without
deleting last term's data.

### Sign-in

Only Google Workspace accounts on an allowed domain are accepted, checked
server-side on every request. `ALLOWED_EMAIL_DOMAINS` is deliberately `nyu.edu`
only. If a student ever turns up on a subdomain such as `@stern.nyu.edu` they
will be refused, and the fix is to add it to that one variable on Railway. A
personal account whose address merely ends in `@nyu.edu` is refused — see
[`server/README.md`](server/README.md) for why that distinction holds.

Sessions live in memory only. Closing the tab signs the student out, and nothing
about their Google account is written to the device.

## Running a new term

1. Bump `BOARD_ID` in `index.html` (e.g. `spring-2027`) and push to `main`. The
   new board is created on first write; the old one stays intact.
2. Confirm the roster's email domains still match `ALLOWED_EMAIL_DOMAINS`.
3. Drop boards you no longer need rather than letting student data accumulate.

Before a class session, a quick health check:

```bash
curl -s https://magnificent-determination-production-f393.up.railway.app/api/health
```

`{"ok":true,"auth":true,"domains":["nyu.edu"]}` means the API and database are
up. If the page ever shows per-device scores instead of the class board, that is
the first thing to check — the game degrades quietly by design.

## Three things to know

- **Resetting the board is instructor-only.** The reset button is shown only to
  accounts on the server's `ADMIN_EMAILS` list, and the server re-checks the
  caller on every delete — hiding the button is the courtesy, not the control.
  If you are an instructor and cannot see it, your address is not on that list.
  `ADMIN_TOKEN` still works as a break-glass path from the command line:

  ```bash
  curl -X DELETE "$API_BASE/api/scores?board=fall-2026" -H "Authorization: Bearer $ADMIN_TOKEN"
  ```
- **Sign-in proves identity, not honesty.** Scores are still computed in the
  browser and a determined student can post a number they did not earn — but it
  is now attributable to a verified account rather than anonymous. Fine as a
  discussion prop; don't grade off it.
- **The board is student data now.** It ties school email addresses to
  performance, so reading it requires sign-in, responses never include emails,
  and old boards should be dropped rather than left to accumulate.
