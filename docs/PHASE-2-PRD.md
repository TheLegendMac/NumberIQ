# Phase 2 — PRD & Architecture

## Product
**NumberIQ** — a local-first Florida Lottery analytics workbench. No accounts, no cloud, no ads.
Runs entirely on the user's machine against a local SQLite database of official draw history.

**Positioning:** the only lottery tool that tells you when it *can't* help you.

## Users & jobs
Single user (owner). Three jobs, in priority order:
1. *"Give me a ticket in under 10 seconds."* — home screen, 3 controls, done.
2. *"Show me I'm not fooling myself."* — backtest vs. random, EV, randomness audit.
3. *"Where do I actually stand?"* — tracker: spend, wins, net, ROI by strategy.

## Non-goals
Prediction. Cloud sync. Multi-user. Real-money integration. Mobile-native app.

---

## Core flows

**F1 — Generate (home).** Pick game → pick strategy → Generate. Tickets render with a Strategy
Score and a one-line explanation. Fixed-payout games show a permanent EV notice. Save to tracker.

**F2 — Ingest.** Data screen → "Sync" pulls official PDFs → parse → validate → diff against DB →
report *added / duplicate / rejected* with reasons. CSV/Excel import via the same validation
pipeline. Never destructive; ingest is idempotent.

**F3 — Analyze.** Per game: frequency, gaps, sums, odd/even, high/low, pairs, positions, plus the
Randomness Audit. Every panel headed with its predictive-power disclosure.

**F4 — Backtest.** Choose strategy + game + window → run against history with a strictly windowed
data accessor → results vs. a Monte Carlo random baseline with confidence intervals → verdict chip.

**F5 — Track.** Saved tickets auto-checked against newly ingested draws. Net position, ROI,
per-strategy breakdown. Budget ceiling blocks generation when exceeded.

---

## Architecture

Local-first, two processes in dev, one in production.

```
Browser (React SPA)  ──HTTP /api──▶  Node server  ──▶  SQLite (better-sqlite3)
                                          │
                                          └──▶ files.floridalottery.com (official PDFs)
```

**Why a server rather than pure browser:** the official sources are PDFs on a cross-origin host —
the browser cannot fetch them (CORS), and SQLite with real indices beats IndexedDB for the scan-heavy
workloads (backtests touch every draw). Compute lives next to the data; the client stays thin.
Server binds to `127.0.0.1` only.

**Compute placement.** Statistics and backtests run server-side and synchronously against
better-sqlite3 (which is fast enough: full-history stats for the largest game is a single indexed
scan). Long backtests stream progress over SSE.

### Stack
| Layer | Choice | Rationale |
|---|---|---|
| Language | TypeScript, strict | Type safety across the shared domain model |
| Server | Node 24 + Express 5 | Minimal, well-understood, zero ceremony |
| DB | SQLite via better-sqlite3 | Synchronous, embedded, no daemon, fast scans |
| Validation | Zod | One schema shared by API, CSV import, and PDF parser |
| PDF | pdfjs-dist | Pure JS text-layer extraction, no native deps |
| Spreadsheet | xlsx (SheetJS) | CSV + Excel in one parser |
| Client | React 19 + Vite | Fast HMR, modern |
| Server state | TanStack Query | Caching, invalidation, no hand-rolled fetch state |
| UI state | Zustand | Small, no boilerplate |
| Styling | Tailwind v4 | Design tokens as CSS vars, dark-first |
| Charts | Recharts | Declarative, sufficient for our chart set |
| Tests | Vitest | Same toolchain as Vite |

### Folder structure
```
NumberIQ/
├─ docs/                    Phase deliverables
├─ shared/src/
│  ├─ games.ts              Game registry: rules, odds, payout model
│  ├─ types.ts              Domain types
│  └─ schemas.ts            Zod schemas (shared by server + client)
├─ server/src/
│  ├─ index.ts              Express bootstrap
│  ├─ db/                   schema.sql, connection, migrations, repositories
│  ├─ ingest/               pdf-extract, layout engine, per-game grammars,
│  │                        spreadsheet import, validation pipeline
│  ├─ analysis/             stats, randomness tests, popularity model
│  ├─ generate/             strategies, scoring, batch optimizer
│  ├─ backtest/             windowed accessor, runner, null baseline
│  └─ routes/               HTTP layer
└─ web/src/
   ├─ components/           Design-system primitives + domain components
   ├─ features/             generate | analyze | backtest | track | data
   ├─ hooks/  lib/  styles/
   └─ App.tsx
```

---

## Database schema

```sql
games            -- static registry mirror (id, name, payout_model, rules json)
draws            -- id, game_id, draw_date, draw_slot, numbers json, extras json,
                 --   source, ingested_at   UNIQUE(game_id, draw_date, draw_slot)
tickets          -- id, game_id, numbers json, extras json, strategy, score,
                 --   cost, created_at, target_draw_date, preset_id
ticket_results   -- ticket_id, draw_id, matches, extra_match, tier, payout, checked_at
presets          -- id, game_id, name, config json
settings         -- key, value            (budgets, preferences)
ingest_runs      -- id, game_id, source, added, duplicates, rejected, log json, ran_at
```

Indices on `draws(game_id, draw_date DESC)` — the access pattern for every stat and backtest —
and on `tickets(game_id, target_draw_date)` for auto-checking.

**Idempotency.** `UNIQUE(game_id, draw_date, draw_slot)` makes re-ingest a no-op. Re-running a
sync never duplicates or corrupts; it reports what it skipped.

---

## Key modeling decisions

**Draw slots.** Pick games (Midday/Evening) and Cash Pop (5 daily slots) are modeled as
`draw_slot` on the draw, and analyzed as independent series — a Pick 3 Midday stat never mixes
Evening draws. This satisfies the brief's requirement without a table per slot.

**Payout model drives the UI.** `payout_model: 'fixed' | 'parimutuel' | 'split_jackpot'` is the
single field that decides whether optimization is offered at all. Fixed-payout games get the
notice and a reduced strategy set. One field, enforced centrally — the honesty can't drift.

**Strategy Score is not a win probability.** It is a 0–100 composite of: distribution balance,
popularity avoidance (weighted 0 on fixed-payout games), coverage contribution within a batch,
and pattern-triviality penalty. Always shown with its component breakdown so it's auditable.

**Look-ahead prevention is structural.** The backtester can only read history through
`WindowedDraws(asOf)`, which physically cannot return a draw dated ≥ asOf. Strategies receive
that accessor rather than the repository, so leakage is impossible by construction rather than
by discipline.
