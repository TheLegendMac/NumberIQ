# Phase 1 — Concept Validation & Statistical Audit

**Verdict: the concept is viable, but only after one hard correction.**

The brief asks for a system that "removes as much guesswork as possible." For lottery
*number selection*, the honest amount of removable guesswork in the **probability of
winning** is exactly **zero**. Every equally-priced combination in every game listed has
identical win probability, always, regardless of history.

But that is not the end of the product — it's the beginning of the *real* one. There is a
genuine, mathematically defensible edge available, and almost nobody builds for it:

> You cannot change your odds of winning. You **can** change how much you collect **if**
> you win, by avoiding number patterns that thousands of other people also picked.

That single distinction is the intellectual spine of NumberIQ. Everything below follows from it.

---

## 1. The hard statistical truths

### 1.1 Draws are independent and memoryless
Florida's draws use certified RNG or gravity-pick machines audited for uniformity. Each draw
is an i.i.d. sample. Therefore:

| Claim | Status |
|---|---|
| "Hot numbers are more likely to repeat" | **False.** Gambler's fallacy (hot-hand variant). |
| "Cold numbers are due" | **False.** Gambler's fallacy, textbook form. |
| "Overdue numbers must catch up" | **False.** Misreads the Law of Large Numbers. |
| "Trends / momentum in a number" | **False.** No autocorrelation exists in a fair draw. |
| "Cluster analysis reveals structure" | **False** as prediction. Clusters appear in *any* random data. |
| "Mirror numbers, digit families, root sums" | **Numerology.** No mechanism. Cut. |

The Law of Large Numbers says frequencies converge in *relative* terms as n→∞. It does **not**
say a deficit gets repaid. Absolute deviations actually grow with √n. "Overdue" inverts the math.

### 1.2 The one place history is legitimately useful
History is useful for exactly three things, none of which are prediction:

1. **Auditing the game itself.** Chi-square goodness-of-fit, runs tests, and serial-correlation
   tests on 20+ years of draws can detect a *biased machine*. This is real statistics with a real
   (if unlikely) payoff, and it's a genuinely interesting feature. If the test comes back clean —
   which it will — that is itself the honest answer, and it's the most persuasive possible
   demonstration to the user that hot/cold is noise.
2. **Estimating what other players pick.** Not from draw history — from *human bias priors*
   (see §2). Draw history contributes only indirectly.
3. **Calibrating expectations.** Showing a user the real distribution of outcomes over 10,000
   simulated draws is the fastest cure for magical thinking ever invented.

### 1.3 Every game is negative-EV
Florida returns roughly 50–65¢ per dollar wagered depending on game. No selection strategy
changes this. The app must state expected value per ticket plainly. A product that hides this
is not "statistically honest," it's a slot machine with charts.

---

## 2. The real edge: payout dilution, not win probability

This is well-documented in the academic literature (Chernoff on Massachusetts numbers games;
Ziemba et al. on Lotto 6/49; Cook & Clotfelter on lottery "conscious selection"). Players do
**not** choose uniformly. Known, robust biases:

- **Calendar bias** — 1–31 wildly over-picked (birthdays, anniversaries). Numbers 32+ are
  structurally under-picked in every 5/36+ and 5/69 game.
- **Low-number bias** — small numbers preferred generally.
- **Lucky/unlucky numbers** — 7 over-picked; 13 under-picked.
- **Playslip geometry** — straight lines, diagonals, and symmetric patterns on the physical
  grid are heavily over-picked.
- **Arithmetic sequences** — 1-2-3-4-5, 5-10-15-20-25 are picked far more than chance.
- **Recent-draw copying** — a nontrivial share of players replay the last winning combination.
- **Sum clustering** — hand-picked tickets bunch near the middle of the sum distribution.

**Consequence:** conditional on winning a *shared* prize tier, a ticket avoiding these
patterns collects a larger share. This raises expected value. It does **not** raise P(win).

### 2.1 Critical: this only works in some games
This is the single most important finding of the audit, and it changes the product's shape.

| Game | Prize model | Does selection affect EV? |
|---|---|---|
| Pick 2 / 3 / 4 / 5 | **Fixed payout** | **No. Zero. None.** |
| Cash Pop | **Fixed payout** | **No. Zero. None.** |
| Fantasy 5 | **Pari-mutuel** (all tiers) | **Yes — meaningfully** |
| Florida Lotto / Jackpot Triple Play | Pari-mutuel jackpot | **Yes** |
| Powerball / Mega Millions | Split jackpot, fixed lower tiers | **Yes, jackpot tier only** |
| Cash4Life | Fixed annuity, liability-capped | **Marginal** (only in cap scenarios) |

In a fixed-payout game, if you win, you are paid a posted amount. It does not matter if ten
thousand other people also picked 4-4-4. **Therefore for Pick 2/3/4/5 and Cash Pop, no
selection method — none, including ours — can improve expected value in any way.**

The app must say this *out loud, on those games' screens*. Any product that offers a
"strategy" for Pick 3 while knowing this is lying to its user. NumberIQ will instead show a
prominent, permanent notice on fixed-payout games and route the user's attention to the
things that *do* matter there: budget discipline and the game's actual EV.

This is a feature, not a limitation. It's the credibility anchor for the entire app.

---

## 3. Feature audit — what survives

### Keep, reframed
| Requested | Disposition |
|---|---|
| Frequency / recency / gap / skip analysis | **Keep as descriptive history only.** Labeled "no predictive power." Never feeds a "better odds" claim. |
| Odd/even, high/low, sum distribution | **Keep** — genuinely useful for *unpopularity* (see §2) and for coverage. |
| Pair/triple co-occurrence | **Keep as descriptive.** Demote from prediction. |
| Position frequency (Pick games) | **Keep** — valid for machine-bias auditing. |
| Backtesting engine | **Keep and elevate.** Its honest job is to *disprove* strategies. |
| Ticket tracker, ROI, budget | **Keep — highest real user value in the app.** |
| Official odds display | **Keep, mandatory.** Plus expected value per ticket. |
| Coverage / low-overlap batches | **Keep — mathematically real.** Wheeling genuinely raises P(≥1 small prize). |

### Cut
- **Mirror numbers, digit families, root sums, "pattern rarity" as prediction** — numerology.
- **"Hybrid AI Strategy"** — an ML model on i.i.d. uniform noise learns nothing. Including it
  would be the single most dishonest feature possible. Cut outright.
- **Trend-based / momentum modes** — no autocorrelation exists to trend on.
- **"Chance to win %" that varies by strategy** — mathematically false.

### Reframe (the important one)
"Hot / Cold / Overdue" are **kept as generator modes** but reclassified as **cosmetic
preference filters**, each shipping with an inline, non-dismissible note: *"This changes which
numbers you get. It does not change your odds. Backtest it yourself →"*. Users want them;
removing them just sends people to worse tools. Keeping them **with the math attached**, and
with a one-click backtest that shows them landing inside the random noise band, is more
honest *and* more educational than pretending they don't exist.

### Add (not requested, but the actual value)
1. **Popularity Index** — models how many *other players* likely picked a combination, from the
   §2 bias priors. Powers the only legitimate optimization in the product.
2. **Expected Value per ticket** — honest, per-game, including jackpot-sharing effects.
3. **Randomness Audit** — chi-square / runs / serial-correlation tests on real Florida history.
4. **Monte Carlo null baseline** — every backtest compared against thousands of simulated random
   strategies, with confidence intervals, so "beat random" claims face a significance test.

---

## 4. Backtesting: the traps

A naive backtester will manufacture false confidence. Guards required:

- **Look-ahead bias** — statistics for a draw on date *d* must be computed strictly from draws
  `< d`. Enforced at the data-access layer (a windowed accessor), not by convention.
- **Multiple comparisons** — testing 10 strategies × 9 games × many windows guarantees some
  "winner" at p<0.05 by chance. Report a multiplicity-corrected view.
- **Survivorship / cherry-picked windows** — always report the full history, plus the *worst*
  window, not just the best.
- **Small-sample noise** — jackpot hits are so rare that ROI over any realistic history is
  dominated by whether a single jackpot landed. ROI confidence intervals will be enormous and
  must be *shown* as such, not collapsed to a point estimate.
- **The honest expected result:** every strategy lands inside the random band. The UI is
  designed to display that clearly and without embarrassment — a verdict chip reading
  **"Not distinguishable from random"** is the default outcome and the correct one.

---

## 5. Legal & ethical

- **Personal use, local-only.** No accounts, no cloud, no telemetry, no ads, no payments.
- **Scraping** — we fetch the Florida Lottery's own published history PDFs (the same files
  linked from their public "Winning Number History" page), at low frequency, cached locally,
  with a descriptive User-Agent. No circumvention, no auth bypass, no bulk hammering.
- **Official records control.** Every ingested dataset carries the Lottery's own disclaimer:
  results shown are informational; the official record governs. Never present the app as an
  authority for prize claims.
- **No gambling advice.** The app must never say "play this." It surfaces math and lets the
  user decide.
- **Harm reduction, built in, not bolted on:** budget ceilings that actually block generation
  when exceeded, cumulative net-loss always visible (not just wins), problem-gambling resources
  (1-800-GAMBLER) in the footer, and no dark patterns, streaks, or near-miss celebration.
- **18+.** Florida's minimum play age is 18.
- **The tracker must show net loss as prominently as wins.** Most gambling tools hide this. Ours
  leads with it. Over time the ROI dashboard will show a negative number — that is the honest
  outcome and the design must not soften it.

---

## 6. Weaknesses we are accepting

- **Popularity Index is a model, not measured truth.** Florida does not publish per-combination
  sales data. Our priors are literature-based and directionally sound, but uncalibrated. It ships
  labeled as an *estimate*, with its inputs visible.
- **Pari-mutuel prize amounts vary per draw.** Backtested ROI for Fantasy 5 uses historical
  average tier payouts, not the actual per-draw amounts (not published in the history files).
  Approximation is disclosed at point of use.
- **PDF sources can change format.** Ingest is version-tolerant and fails loudly with a clear
  diagnostic rather than silently importing garbage.
- **Cash Pop's 5 daily draws** have separate prize structures by draw slot; treated as five
  independent draw series.

---

## 7. What "good" looks like

NumberIQ succeeds if a user finishes a session **better calibrated than they started**: knowing
their real odds, their real expected loss, their actual net position, and — where it legitimately
applies — holding a ticket that doesn't share its jackpot with 40,000 birthday players.

It fails if it ever makes someone feel they've found an edge that isn't there.
