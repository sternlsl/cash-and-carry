# Stern Cash & Carry — The Profit vs. Cash Challenge

A single-file interactive scenario for an introductory financial accounting course.
Students run a small retailer for four quarters and learn — by playing — why
**net income and cash are not the same thing**.

## What changed from the original draft

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

## Deploying

The game is still one static file — `index.html`, no build step — served from
**GitHub Pages**. Settings → Pages → deploy from `main`, root.

The leaderboard is now backed by a small API in [`server/`](server/) running on
**Railway** (Node + Postgres), so an entire class shares one board instead of one
board per browser. See [`server/README.md`](server/README.md) for the deploy
steps and environment variables.

Students sign in with their NYU Google account, so each student appears once and
under a consistent identity. To connect the page to the backend, set three
constants near the top of the script block in `index.html`:

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
server-side on every request. The server's `ALLOWED_EMAIL_DOMAINS` defaults to
`nyu.edu`; **if any students have `@stern.nyu.edu` addresses, add that domain
explicitly** or they will be locked out. A personal account whose address merely
ends in `@nyu.edu` is refused — see [`server/README.md`](server/README.md) for
why that distinction holds.

Sessions live in memory only. Closing the tab signs the student out, and nothing
about their Google account is written to the device.

### Three things to know

- **Resetting the board is instructor-only.** Against a shared backend the reset
  button would otherwise let any student wipe the class from their laptop. An
  instructor on the server's `ADMIN_EMAILS` list can reset by signing in; there
  is also a shared `ADMIN_TOKEN` fallback.
- **Sign-in proves identity, not honesty.** Scores are still computed in the
  browser and a determined student can post a number they did not earn — but it
  is now attributable to a verified account rather than anonymous. Fine as a
  discussion prop; don't grade off it.
- **The board is student data now.** It ties school email addresses to
  performance, so reading it requires sign-in, responses never include emails,
  and old boards should be dropped rather than left to accumulate.
