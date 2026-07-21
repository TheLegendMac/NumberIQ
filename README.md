# NumberIQ

A local-first Florida Lottery analytics workbench. No accounts, no cloud, no telemetry, no ads.
Everything runs on your machine against a local SQLite database of official draw history.

**Positioning: the only lottery tool that tells you when it can't help you.**

---

## The honest premise

NumberIQ will not predict lottery numbers, because nothing can. Draws are independent and
uniform — hot, cold, overdue and "trending" numbers have exactly zero predictive power, and the
app says so wherever those modes appear.

There is, however, one real and mathematically defensible edge, and NumberIQ is built around it:

> You cannot change your **odds of winning**. In games that split prizes among winners, you *can*
> change **how much you collect if you win**, by avoiding combinations thousands of other people
> also picked.

Crucially, this only applies to some games:

| Game | Prize model | Can selection affect expected value? |
|---|---|---|
| Pick 2 / 3 / 4 / 5, Cash Pop | Fixed payout | **No. Not at all.** |
| Fantasy 5, Florida Lotto, Jackpot Triple Play | Pari-mutuel | **Yes** |
| Powerball, Mega Millions | Split jackpot | **Yes, at the jackpot tier** |
| Cash4Life | Mostly fixed | Marginal |

On fixed-payout games the app shows a permanent, non-dismissible notice saying no strategy —
including its own — can improve your expected value, and it hides the strategies that would
imply otherwise. That constraint is enforced in code and covered by tests.

---

## Getting started

```bash
npm install
npx tsx server/src/cli/seed.ts    # download & ingest official history (~87k draws, under a minute)
npm run dev                       # server on :5178, UI on :5177
```

Open <http://localhost:5177>.

```bash
npm test          # 116 tests
npm run typecheck
npm run build     # production bundle; `npm start` then serves it from the server
```

---

## Hosting on Cloudflare

Live: **https://numberiq.trappers-edge.workers.dev**

```bash
npm run d1:create      # once — then paste the id into wrangler.jsonc
npm run d1:seed        # migrate + export local drawings + push to D1
npm run cf:deploy      # build the SPA and deploy the Worker
```

### How the hosted version differs

The Worker is deliberately thin: it serves the SPA and does D1 reads/writes,
nothing more. **All analysis runs in the browser** — statistics, the randomness
audit, generation and backtesting.

That is not a shortcut. A backtest runs hundreds of Monte Carlo replications over
hundreds of drawings; that is seconds of CPU and would exceed a Worker's
per-request CPU budget. Because everything in `shared/src/core` is pure
TypeScript with no platform APIs, the identical code runs in Node locally, in the
browser when hosted, and in the Worker if it ever needs to. Drawing history is
fetched once per game and cached, so re-running a backtest costs no network at all.

**Ingest stays local.** Parsing ~87k drawings out of the Lottery's PDFs is far
beyond a Worker's CPU budget, and an open sync endpoint would let anyone point
your deployment at the Lottery's servers. So `/api/data/*/sync` returns 501 when
hosted. To refresh the hosted data:

```bash
npx tsx server/src/cli/seed.ts   # download + parse locally
npm run d1:export                # -> data/d1-seed.sql
npm run d1:push                  # INSERT OR IGNORE, so it is idempotent
```

### Cost

Free tier is sufficient: D1 holds the full history in ~17 MB against a 500 MB
limit, and the Worker only serves assets and small JSON reads.

### The deployment has no login

Anyone with the URL can use it, including saving tickets and editing budgets.
Nothing sensitive is exposed, but if you want it genuinely private, put
Cloudflare Access in front of it (free for personal use) rather than building auth.

---

## What it does

**Ingest.** Downloads the Florida Lottery's own published winning-number history PDFs for all 11
games and parses them with a geometric layout engine (y-clustering → column splitting → per-game
grammar). Currently ingests **86,849 draws back to 1988 with zero parse failures**. CSV and Excel
import work as a fallback and pass through identical validation.

**Analyze.** Frequency, gaps, sums, parity, high/low, consecutive runs, repeats, positional
distributions and pair co-occurrence — every panel labelled with its (nil) predictive power.

**Randomness audit.** The one place history supports genuine inference. Chi-square goodness of
fit, positional uniformity, lag-1 serial correlation, a Wald–Wolfowitz runs test and a repeat-rate
test, all run against the real data to check whether the *drawing process* is fair. It reliably
detects a rigged machine in tests, and reliably finds Florida's draws clean — which is the most
direct demonstration available that hot/cold patterns are noise.

**Generate.** Eight strategies, honestly classified as `ev_positive`, `neutral` or `cosmetic`.
Locks, requires, exclusions, trivial-pattern rejection, and batch shaping (low-overlap / coverage).

**Strategy Score.** A 0–100 composite of distribution balance, payout-sharing avoidance, pattern
distinctiveness and batch coverage. Never a probability, never rendered with a `%`, always
expandable into its weighted components.

**Backtest.** Runs strategies against real history and compares them to a **Monte Carlo null
distribution** of hundreds of random runs — because comparing against a single random run is
meaningless. Reports percentile, p-value and a verdict chip. The expected and near-universal
result is "not distinguishable from random."

**Track.** Saved tickets are auto-checked as results arrive. Net position leads the page and is
the largest figure on it; budgets are a hard gate that actually blocks generation.

---

## Design decisions worth knowing

**Matrix eras.** Lottery matrices change. Mega Millions ran 5/70+1/25 until April 2025;
Powerball ran 5/59+1/35 before 2015; Fantasy 5 was 5/26 until 2001. Draws are validated against
the matrix *in effect on their own date*, and statistics are restricted to the current era.
Skipping this makes numbers added later look permanently "cold" — during development it produced
a spurious z-score of 5.27 on Fantasy 5 before being fixed.

**Look-ahead is structurally impossible.** Backtested strategies receive a history slice strictly
below the draw being tested. They never get the repository, so leakage cannot happen by mistake.

**Jackpots are valued at $0 in backtests.** One simulated jackpot would swamp every other number
and make ROI meaningless. Jackpot-tier hits are counted and reported separately.

**Schedule-aware gap detection.** Drawing schedules change (Powerball added Mondays in 2021), so
the weekday pattern is inferred from recent draws only and scanned over a bounded window.
Projecting today's schedule across all history invents thousands of "missing" draws that were
never scheduled.

**Odds are derived, not copied.** Every prize tier is recomputed from the game matrix in tests and
checked against the Lottery's published overall odds. This caught a real error during development
(Mega Millions 4+MB is 1 in 893,761, not 893,760).

---

## What was cut, and why

- **"Hybrid AI Strategy"** — an ML model trained on i.i.d. uniform noise learns nothing. It would
  have been the most dishonest feature in the product.
- **Mirror numbers, root sums, digit families** — numerology with no mechanism.
- **Trend/momentum modes** — there is no autocorrelation in a fair draw to trend on.
- **Per-strategy "chance to win %"** — mathematically false.

Hot / Cold / Overdue were **kept**, reclassified as cosmetic preference filters with permanent
inline disclosures and a one-click backtest. Removing them just sends people to worse tools;
keeping them with the math attached is both more honest and more useful.

---

## Architecture

```
web/     React 19 + Vite + TanStack Query + Recharts   (hand-rolled token-based design system)
server/  Node + Express + better-sqlite3               (ingest, analysis, generation, backtest)
shared/  Game registry, domain types, Zod schemas, statistical primitives
docs/    Phase 1 audit · Phase 2 PRD · Phase 3 design
```

A local server exists because the official sources are cross-origin PDFs the browser cannot fetch,
and because scan-heavy backtests want SQLite with real indices. It binds to `127.0.0.1` only.

---

## Limitations, stated plainly

- **The popularity model is a model, not measurement.** Florida does not publish per-combination
  sales data. Weights come from the published literature on lottery number selection (Chernoff;
  Ziemba et al.; Cook & Clotfelter), so they are directionally sound but uncalibrated in magnitude.
- **Pari-mutuel prize amounts vary per draw.** Backtests use historical averages; actual payouts
  depend on sales and winner counts.
- **Every game here is negative expected value.** No feature in this application changes that.

---

## Legal & ethical

Personal use. Informational only — the official records of the Florida Lottery are controlling,
and any winning ticket should be verified against them. Data is fetched from the Lottery's own
public history files at low frequency and cached locally. 18+.

Lottery play is gambling, not investing. If it stops being fun: **1-800-GAMBLER**.
