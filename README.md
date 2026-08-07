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

## Deploying to Netlify

Everything is one static file — `index.html` — with no build step.

- **Drag & drop:** zip or drag this folder onto https://app.netlify.com/drop
- **CLI:** `netlify deploy --prod --dir .`

The leaderboard is stored in the browser's `localStorage`, so it is per-device
(e.g., per lab machine or per student laptop). Clearing it is available on the
final screen.
