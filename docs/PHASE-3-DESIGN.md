# Phase 3 — UI/UX Design

## Principle
The home screen does one job: **game → strategy → Generate**. Everything else is one click away
and never in the way. Analytics are a destination, not a toll booth.

## Design system

**Dark-first.** Near-black canvas, elevated surfaces, one accent. Light mode supported via tokens.

```
--bg          #0A0B0D    canvas
--surface     #131519    cards
--surface-2   #1B1F26    inputs, elevated
--border      #262B34
--text        #E9EDF3
--muted       #8B94A3
--accent      #4F8DF7    primary action, focus ring
--pos         #37D399    gains
--neg         #F76B6B    losses
--warn        #F5B84C    disclosures
```

Type: system stack; numerics in `tabular-nums` everywhere a figure can change (tables, scores,
ROI) so digits don't jitter. Radius 10px. Spacing on a 4px scale. Motion ≤150ms, and fully
disabled under `prefers-reduced-motion`.

**Semantic color discipline:** green/red are reserved *exclusively* for money outcomes. Strategy
Score uses the neutral accent ramp — a high score must never read as "likely to win."

## Navigation
Persistent left rail (desktop) / bottom tab bar (mobile), 5 destinations:
**Generate · Analyze · Backtest · Tickets · Data**

Generate is the default route.

## Wireframes

**Generate (home)**
```
┌──────────────────────────────────────────────────────┐
│ [Game ▾ Fantasy 5]  [Strategy ▾ Balanced]  [ Generate ]│
│ Odds 1 in 376,992 · EV −$0.47 per $1        [Advanced ▾]│
├──────────────────────────────────────────────────────┤
│  ⚠ Fixed-payout game — number choice cannot change    │  ← fixed games only
│    your expected value. Shown for interest only.      │
├──────────────────────────────────────────────────────┤
│  ┌ 04 · 17 · 22 · 31 · 35 ──────────── Score 82 ┐    │
│  │ Avoids calendar-clustered numbers; balanced    │    │
│  │ spread.        [why?] [lock] [save]            │    │
│  └───────────────────────────────────────────────┘    │
│  … more tickets …                                     │
│  Batch overlap: 0.4 shared numbers avg   [Save all]   │
└──────────────────────────────────────────────────────┘
```
Advanced (collapsed by default): exclude / lock / require numbers, quantity, batch mode
(coverage · low-overlap · budget), presets.

**Backtest** — config strip on top; results as a verdict chip first, then metrics, then chart:
```
  ┌ Not distinguishable from random ─────────────────┐
  │ Strategy ROI −48.2%   Random baseline −48.6%      │
  │ Δ +0.4pp   95% CI [−6.1, +6.9]   n=1,204 draws    │
  └──────────────────────────────────────────────────┘
```
The verdict leads. Numbers support it. A user who reads only the chip has the correct takeaway.

**Tickets** — net position first and largest, wins never styled more prominently than losses.

**Data** — per-game rows: draw count, date span, last sync, gaps detected, [Sync] [Import].

## Component hierarchy
```
App
└─ AppShell (nav, header, disclosure footer)
   ├─ GeneratePage → GameSelect · StrategySelect · OddsBar · PayoutNotice
   │                 AdvancedPanel · TicketCard(score, explanation) · BatchSummary
   ├─ AnalyzePage  → StatPanel* (frequency, gaps, sums, parity, pairs, positions)
   │                 RandomnessAudit
   ├─ BacktestPage → BacktestConfig · VerdictChip · MetricGrid · EquityChart
   ├─ TicketsPage  → NetPositionHeader · TicketTable · StrategyBreakdown
   └─ DataPage     → GameDataRow · SyncButton · ImportDialog · IngestLog
```
Primitives: `Button · Select · Card · Chip · Stat · Table · Dialog · Toggle · NumberBall ·
Disclosure · EmptyState · Skeleton`.

## Accessibility
Semantic landmarks; visible focus rings on the accent token; all interactive targets ≥44px on
touch; charts paired with an accessible table or text summary (never color-only encoding);
`aria-live` on generation results; contrast ≥4.5:1 verified against the dark palette.

## Honesty in the interface
Disclosure is **structural, not a footnote**:
- Official odds and EV sit in the same strip as the Generate button — visible before you act.
- The fixed-payout notice is non-dismissible on affected games.
- Every hot/cold/overdue control carries an inline "does not change your odds" note.
- Strategy Score never renders with a % sign or the word "chance."
