/**
 * Backtesting engine.
 *
 * The single most important property of this module is that it should *fail to
 * find edges*. Its job is to tell the user the truth, and the truth is that every
 * selection strategy performs the same as random over any honest sample.
 *
 * Three design decisions enforce that honesty:
 *
 *  1. LOOK-AHEAD IS STRUCTURALLY IMPOSSIBLE. A strategy is handed `history`
 *     sliced strictly below the draw being predicted. It never receives the
 *     repository, so it cannot reach forward even by mistake.
 *
 *  2. THE BASELINE IS A DISTRIBUTION, NOT A SINGLE RUN. Comparing one strategy
 *     run against one random run is meaningless — random beats random half the
 *     time. We run hundreds of independent random replications over the same
 *     draws to build a null distribution, then report where the strategy lands
 *     inside it. That is what makes "beat random" a testable claim.
 *
 *  3. JACKPOTS ARE EXCLUDED FROM ROI BY DEFAULT. A single simulated jackpot
 *     would swamp every other signal and produce absurd ROI figures. Jackpot
 *     tier hits are counted and reported separately.
 */
import type { Draw, GameDefinition, StrategyId } from '../index.js';
import { makeRng, mean, percentileRank, quantile, stdev } from '../index.js';
import { generateTickets } from './generate.js';
import { evaluateTicket } from './evaluate.js';

export interface BacktestConfig {
  game: GameDefinition;
  slot: string;
  strategies: StrategyId[];
  ticketsPerDraw: number;
  /** Cap on how many of the most recent draws to test. */
  maxDraws: number;
  /** Draws reserved as history before testing starts. */
  minHistory: number;
  /** Replications used to build the random null distribution. */
  nullReplications: number;
  seed: number;
  /**
   * Optional progress callback. The web build runs this in a Worker and reports
   * real progress rather than an indeterminate spinner.
   */
  onProgress?: (phase: 'baseline' | 'strategies', completed: number, total: number) => void;
}

export interface StrategyResult {
  strategy: StrategyId;
  drawsTested: number;
  ticketsPlayed: number;
  spend: number;
  winnings: number;
  net: number;
  roi: number;
  returnPct: number;
  winCount: number;
  winRate: number;
  jackpotHits: number;
  tierCounts: Record<string, number>;
  longestLosingStreak: number;
  /** Where this ROI falls in the random null distribution (0-1). */
  percentileVsRandom: number;
  /** Two-sided p-value from the null distribution. */
  pValue: number;
  verdict: 'not_distinguishable' | 'better_than_random' | 'worse_than_random';
  equityCurve: Array<{ index: number; date: string; net: number }>;
}

export interface BacktestResult {
  gameId: string;
  slot: string;
  drawsTested: number;
  window: { from: string; to: string };
  ticketsPerDraw: number;
  costPerTicket: number;
  nullDistribution: {
    replications: number;
    meanRoi: number;
    stdevRoi: number;
    p05: number;
    p95: number;
  };
  strategies: StrategyResult[];
  caveats: string[];
  summary: string;
}

function runOne(
  cfg: BacktestConfig,
  strategy: StrategyId,
  draws: Draw[],
  seed: number,
  collectCurve: boolean,
): Omit<StrategyResult, 'percentileVsRandom' | 'pValue' | 'verdict'> {
  const { game, minHistory, ticketsPerDraw } = cfg;
  const cost = game.basePrice * ticketsPerDraw;

  let spend = 0;
  let winnings = 0;
  let winCount = 0;
  let ticketsPlayed = 0;
  let jackpotHits = 0;
  let streak = 0;
  let longestLosingStreak = 0;
  const tierCounts: Record<string, number> = {};
  const equityCurve: StrategyResult['equityCurve'] = [];

  for (let i = minHistory; i < draws.length; i++) {
    const target = draws[i]!;
    // The strategy sees only draws strictly before the one being predicted.
    const history = draws.slice(0, i);

    const { tickets } = generateTickets({
      game,
      history,
      strategy,
      count: ticketsPerDraw,
      batchMode: 'low_overlap',
      avoidTrivialPatterns: false,
      seed: seed + i * 7919,
      asOfDate: target.drawDate,
    });

    spend += cost;
    ticketsPlayed += tickets.length;
    let drawWon = false;

    for (const t of tickets) {
      // jackpotValue defaults to 0: an imagined jackpot must never inflate ROI.
      const ev = evaluateTicket(game, t, target);
      if (ev.tier) {
        tierCounts[ev.tier.label] = (tierCounts[ev.tier.label] ?? 0) + 1;
        if (ev.tier.isJackpot) jackpotHits++;
        if (ev.payout > 0) {
          winnings += ev.payout;
          winCount++;
          drawWon = true;
        }
      }
    }

    if (drawWon) streak = 0;
    else {
      streak++;
      if (streak > longestLosingStreak) longestLosingStreak = streak;
    }

    if (collectCurve && (i - minHistory) % Math.max(1, Math.floor((draws.length - minHistory) / 200)) === 0) {
      equityCurve.push({ index: i - minHistory, date: target.drawDate, net: winnings - spend });
    }
  }

  const drawsTested = Math.max(0, draws.length - minHistory);
  return {
    strategy,
    drawsTested,
    ticketsPlayed,
    spend,
    winnings,
    net: winnings - spend,
    roi: spend > 0 ? (winnings - spend) / spend : 0,
    returnPct: spend > 0 ? winnings / spend : 0,
    winCount,
    winRate: ticketsPlayed > 0 ? winCount / ticketsPlayed : 0,
    jackpotHits,
    tierCounts,
    longestLosingStreak,
    equityCurve,
  };
}

export function runBacktest(cfg: BacktestConfig, allDraws: Draw[]): BacktestResult {
  const ascending = [...allDraws].sort((a, b) => a.drawDate.localeCompare(b.drawDate));
  const draws =
    ascending.length > cfg.maxDraws + cfg.minHistory
      ? ascending.slice(ascending.length - (cfg.maxDraws + cfg.minHistory))
      : ascending;

  if (draws.length <= cfg.minHistory + 10) {
    throw new Error(
      `Not enough history: ${draws.length} draws available, need more than ${cfg.minHistory + 10}.`,
    );
  }

  // --- Build the null distribution from independent random replications ----
  const nullRois: number[] = [];
  const rng = makeRng(cfg.seed);
  const reportEvery = Math.max(1, Math.floor(cfg.nullReplications / 25));
  for (let r = 0; r < cfg.nullReplications; r++) {
    const res = runOne(cfg, 'random', draws, Math.floor(rng() * 2 ** 31), false);
    nullRois.push(res.roi);
    if (cfg.onProgress && (r % reportEvery === 0 || r === cfg.nullReplications - 1)) {
      cfg.onProgress('baseline', r + 1, cfg.nullReplications);
    }
  }
  nullRois.sort((a, b) => a - b);
  const nullMean = mean(nullRois);
  const nullSd = stdev(nullRois);

  // --- Run each requested strategy once ------------------------------------
  const strategies: StrategyResult[] = cfg.strategies.map((s, i) => {
    cfg.onProgress?.('strategies', i + 1, cfg.strategies.length);
    const base = runOne(cfg, s, draws, cfg.seed + 104_729, true);
    const pct = percentileRank(nullRois, base.roi);
    // Two-sided p-value from the empirical null.
    const pValue = Math.min(1, 2 * Math.min(pct, 1 - pct));
    const verdict: StrategyResult['verdict'] =
      pValue >= 0.05 ? 'not_distinguishable' : base.roi > nullMean ? 'better_than_random' : 'worse_than_random';
    return { ...base, percentileVsRandom: pct, pValue, verdict };
  });

  const drawsTested = draws.length - cfg.minHistory;
  const caveats: string[] = [
    'Jackpot and pari-mutuel tiers are valued at $0 in these ROI figures. A single simulated jackpot would dominate every other number and make the comparison meaningless. Jackpot-tier hits are counted separately.',
    `Fixed prize amounts are used for tiers that post one. ${cfg.game.name} tiers marked as estimates use historical averages, so ROI is approximate.`,
    `Multiple strategies were tested at once. With ${cfg.strategies.length} strategies, roughly ${(cfg.strategies.length * 0.05).toFixed(2)} would clear p < 0.05 by chance alone — treat any single "beat random" result with suspicion.`,
  ];
  if (cfg.game.payoutModel === 'fixed') {
    caveats.unshift(
      `${cfg.game.name} pays fixed amounts, so every strategy has mathematically identical expected value. Any difference below is sampling noise, guaranteed.`,
    );
  }

  const beat = strategies.filter((s) => s.verdict === 'better_than_random');
  const summary =
    beat.length === 0
      ? `No strategy performed differently from random over ${drawsTested.toLocaleString()} draws. This is the expected and correct result — lottery draws are independent, so selection method cannot affect win rate.`
      : `${beat.map((b) => b.strategy).join(', ')} landed outside the random band, but with ${cfg.strategies.length} strategies tested this is most likely chance. Re-run with a different seed or window before reading anything into it.`;

  return {
    gameId: cfg.game.id,
    slot: cfg.slot,
    drawsTested,
    window: { from: draws[cfg.minHistory]?.drawDate ?? '', to: draws[draws.length - 1]?.drawDate ?? '' },
    ticketsPerDraw: cfg.ticketsPerDraw,
    costPerTicket: cfg.game.basePrice,
    nullDistribution: {
      replications: cfg.nullReplications,
      meanRoi: nullMean,
      stdevRoi: nullSd,
      p05: quantile(nullRois, 0.05),
      p95: quantile(nullRois, 0.95),
    },
    strategies,
    caveats,
    summary,
  };
}
