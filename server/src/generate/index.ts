/**
 * Ticket generation.
 *
 * Every strategy reduces to a weight vector over the number pool plus a set of
 * hard constraints. That uniformity is deliberate: it means "Hot" and "Pure
 * Random" run through identical machinery and differ only in their weights, so
 * the backtester compares like with like and no strategy gets special treatment.
 */
import type {
  Draw, GameDefinition, GeneratedTicket, ScoreComponent, StrategyId, StrategyScore,
} from '@numberiq/shared';
import { clamp, makeRng, matrixForDate, weightedSampleDistinct } from '@numberiq/shared';
import { estimatePopularity, numberPopularityWeight } from '../analysis/popularity.js';

export interface GenerateContext {
  game: GameDefinition;
  /** History available to the strategy. Backtests pass a strictly windowed slice. */
  history: Draw[];
  strategy: StrategyId;
  count: number;
  exclude?: number[];
  lock?: number[];
  require?: number[];
  avoidTrivialPatterns?: boolean;
  batchMode?: 'independent' | 'low_overlap' | 'coverage';
  /** Recency window for hot/cold/overdue. */
  windowSize?: number;
  seed?: number;
  asOfDate?: string;
}

interface PoolInfo {
  pool: number[];
  min: number;
  max: number;
}

function poolFor(ctx: GenerateContext): PoolInfo {
  const { game } = ctx;
  const ref = ctx.asOfDate ?? ctx.history[ctx.history.length - 1]?.drawDate;
  const m = ref ? matrixForDate(game, ref) : { min: game.min, max: game.max };
  const pool: number[] = [];
  for (let v = m.min; v <= m.max; v++) pool.push(v);
  return { pool, min: m.min, max: m.max };
}

/** Frequency and gap tallies over the strategy's history window. */
function tallies(ctx: GenerateContext, pool: number[]) {
  const window = ctx.windowSize ?? 200;
  const recent = ctx.history.slice(-window);
  const counts = new Map<number, number>(pool.map((v) => [v, 0]));
  const lastIdx = new Map<number, number>();

  recent.forEach((d, i) => {
    for (const v of d.numbers) {
      if (counts.has(v)) counts.set(v, counts.get(v)! + 1);
      lastIdx.set(v, i);
    }
  });
  const gaps = new Map<number, number>(
    pool.map((v) => [v, lastIdx.has(v) ? recent.length - 1 - lastIdx.get(v)! : recent.length]),
  );
  return { counts, gaps, sampleSize: recent.length };
}

/**
 * Per-number weights for a strategy. Uniform weights (all 1) reproduce pure random.
 * Cosmetic strategies produce non-uniform weights that change *which* numbers appear
 * without changing any probability that matters.
 */
export function strategyWeights(ctx: GenerateContext, pool: number[]): number[] {
  const { strategy, game } = ctx;

  if (strategy === 'random') return pool.map(() => 1);

  if (strategy === 'unpopular' || strategy === 'balanced') {
    // On fixed-payout games popularity is meaningless — fall back to uniform.
    if (game.payoutModel === 'fixed') return pool.map(() => 1);
    const inv = pool.map((n) => 1 / numberPopularityWeight(n));
    if (strategy === 'unpopular') return inv;
    // Balanced: a softened tilt, so tickets stay well-spread rather than all high numbers.
    return inv.map((w) => Math.pow(w, 0.5));
  }

  const { counts, gaps, sampleSize } = tallies(ctx, pool);
  const maxCount = Math.max(1, ...pool.map((v) => counts.get(v) ?? 0));
  const maxGap = Math.max(1, ...pool.map((v) => gaps.get(v) ?? 0));

  switch (strategy) {
    case 'hot':
      return pool.map((v) => 0.15 + 2 * ((counts.get(v) ?? 0) / maxCount));
    case 'cold':
      return pool.map((v) => 0.15 + 2 * (1 - (counts.get(v) ?? 0) / maxCount));
    case 'overdue':
      return pool.map((v) => 0.15 + 2 * ((gaps.get(v) ?? 0) / maxGap));
    case 'frequency_weighted':
      return pool.map((v) => Math.max(0.05, (counts.get(v) ?? 0) / Math.max(1, sampleSize)));
    case 'contrarian':
      return pool.map((v) => Math.max(0.05, 1 - (counts.get(v) ?? 0) / maxCount));
    default:
      return pool.map(() => 1);
  }
}

/** Trivial shapes that are both over-picked by other players and visually obvious. */
export function isTrivialPattern(game: GameDefinition, numbers: number[]): boolean {
  if (game.kind === 'digits' || numbers.length < 3) return false;
  const s = [...numbers].sort((a, b) => a - b);

  const step = s[1]! - s[0]!;
  if (step !== 0 && s.every((v, i) => i === 0 || v - s[i - 1]! === step)) return true;

  let run = 1;
  for (let i = 1; i < s.length; i++) {
    if (s[i]! === s[i - 1]! + 1) run++;
    else run = 1;
    if (run >= 4) return true;
  }

  if (new Set(s.map((n) => Math.floor(n / 10))).size === 1) return true;
  if (game.max > 31 && s.every((n) => n <= 31)) return false; // common, but not "trivial"
  return false;
}

function digitsTicket(ctx: GenerateContext, rng: () => number): number[] {
  const { game } = ctx;
  const excluded = new Set(ctx.exclude ?? []);
  const out: number[] = [];
  for (let p = 0; p < game.pick; p++) {
    const locked = ctx.lock?.[p];
    if (locked !== undefined && locked >= 0 && locked <= 9) {
      out.push(locked);
      continue;
    }
    const candidates = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => !excluded.has(d));
    const pickFrom = candidates.length ? candidates : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    out.push(pickFrom[Math.floor(rng() * pickFrom.length)]!);
  }
  return out;
}

export interface GenerateResult {
  tickets: GeneratedTicket[];
  batch: {
    averageOverlap: number;
    distinctNumbers: number;
    poolCoverage: number;
  };
  warnings: string[];
}

export function generateTickets(ctx: GenerateContext): GenerateResult {
  const { game } = ctx;
  const rng = makeRng(ctx.seed ?? (Date.now() & 0xffffffff));
  const { pool, min, max } = poolFor(ctx);
  const warnings: string[] = [];

  const exclude = new Set((ctx.exclude ?? []).filter((n) => n >= min && n <= max));
  const require = [...new Set((ctx.require ?? []).filter((n) => n >= min && n <= max))];
  const lock = [...new Set((ctx.lock ?? []).filter((n) => n >= min && n <= max))];
  const forced = game.kind === 'digits' ? [] : [...new Set([...lock, ...require])];

  if (forced.length > game.pick) {
    warnings.push(`More locked/required numbers (${forced.length}) than the game draws (${game.pick}). Extras ignored.`);
    forced.length = game.pick;
  }
  const available = pool.filter((n) => !exclude.has(n) && !forced.includes(n));
  if (game.kind === 'combination' && available.length + forced.length < game.pick) {
    warnings.push('Too many numbers excluded to build a valid ticket — exclusions were relaxed.');
    exclude.clear();
  }

  const baseWeights = strategyWeights(ctx, pool);
  const weightOf = new Map(pool.map((n, i) => [n, baseWeights[i]!]));

  // Batch shaping: numbers already used are down-weighted so a batch spreads out.
  const usage = new Map<number, number>();
  const tickets: GeneratedTicket[] = [];
  const recentDraws = ctx.history.slice(-50);

  /**
   * EV-positive strategies must actually *optimise* their objective, not merely
   * lean toward it. Weighted sampling alone is too weak: in a 5/36 game only five
   * numbers sit outside the 1-31 calendar range, so a probability tilt regularly
   * produces tickets the popularity model itself rates as above-average popular —
   * i.e. the strategy failing at the one thing that justifies it. Drawing several
   * candidates and keeping the best against the objective fixes that directly.
   */
  const optimises = (ctx.strategy === 'unpopular' || ctx.strategy === 'balanced') &&
    game.payoutModel !== 'fixed' && game.kind === 'combination';
  const CANDIDATES = optimises ? 60 : 1;

  const drawOne = (): number[] => {
    if (game.kind === 'digits') return digitsTicket(ctx, rng);
    const candidates = pool.filter((n) => !exclude.has(n) && !forced.includes(n));
    const weights = candidates.map((n) => {
      let w = weightOf.get(n) ?? 1;
      if (ctx.batchMode === 'low_overlap') w /= 1 + 2.5 * (usage.get(n) ?? 0);
      else if (ctx.batchMode === 'coverage') w /= 1 + 12 * (usage.get(n) ?? 0);
      return w;
    });
    const need = game.pick - forced.length;
    const picked = weightedSampleDistinct(candidates, weights, need, rng);
    return [...forced, ...picked].sort((a, b) => a - b);
  };

  const MAX_ATTEMPTS = 40;
  for (let t = 0; t < ctx.count; t++) {
    let numbers: number[] = [];
    let bestObjective = -Infinity;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let candidate: number[] = [];

      if (optimises) {
        // Keep the least-popular candidate of the batch.
        let best: number[] = [];
        let bestScore = -Infinity;
        for (let c = 0; c < CANDIDATES; c++) {
          const trial = drawOne();
          if (trial.length !== game.pick) continue;
          if (ctx.avoidTrivialPatterns !== false && isTrivialPattern(game, trial)) continue;
          const pop = estimatePopularity(game, trial, { recentDraws }).index;
          // Balanced trades some unpopularity for distribution quality.
          const score = ctx.strategy === 'unpopular'
            ? -pop
            : -pop * 0.6 + balanceScore(game, trial) * 0.4;
          if (score > bestScore) { bestScore = score; best = trial; }
        }
        candidate = best;
        bestObjective = bestScore;
      } else {
        candidate = drawOne();
      }

      numbers = candidate;
      if (numbers.length !== game.pick) continue;
      if (ctx.avoidTrivialPatterns !== false && isTrivialPattern(game, numbers)) continue;
      break;
    }
    void bestObjective;

    for (const n of numbers) usage.set(n, (usage.get(n) ?? 0) + 1);

    const extras: Record<string, number> = {};
    if (game.extraBall) {
      const m = ctx.asOfDate ? matrixForDate(game, ctx.asOfDate) : null;
      const hi = m?.extraMax ?? game.extraBall.max;
      extras[game.extraBall.key] = game.extraBall.min + Math.floor(rng() * (hi - game.extraBall.min + 1));
    }

    tickets.push({ numbers, extras, score: scoreTicket(game, numbers, recentDraws, tickets) });
  }

  return { tickets, batch: batchMetrics(game, tickets, pool.length), warnings };
}

/** Distribution quality of a combination, 0-100. Used as the balanced objective. */
function balanceScore(game: GameDefinition, numbers: number[]): number {
  const odd = numbers.filter((n) => n % 2 === 1).length;
  const mid = (game.min + game.max) / 2;
  const high = numbers.filter((n) => n > mid).length;
  const ideal = game.pick / 2;
  const parity = 100 - (Math.abs(odd - ideal) / ideal) * 100;
  const range = 100 - (Math.abs(high - ideal) / ideal) * 100;
  const s = [...numbers].sort((a, b) => a - b);
  const span = s[s.length - 1]! - s[0]!;
  const idealSpan = (game.max - game.min) * 0.75;
  const spread = 100 - clamp((Math.abs(span - idealSpan) / idealSpan) * 100, 0, 100);
  return (parity + range + spread) / 3;
}

function batchMetrics(game: GameDefinition, tickets: GeneratedTicket[], poolSize: number) {
  const distinct = new Set<number>();
  for (const t of tickets) for (const n of t.numbers) distinct.add(n);

  let overlapSum = 0;
  let pairs = 0;
  for (let i = 0; i < tickets.length; i++) {
    for (let j = i + 1; j < tickets.length; j++) {
      const a = new Set(tickets[i]!.numbers);
      overlapSum += tickets[j]!.numbers.filter((n) => a.has(n)).length;
      pairs++;
    }
  }
  return {
    averageOverlap: pairs ? overlapSum / pairs : 0,
    distinctNumbers: distinct.size,
    poolCoverage: poolSize ? distinct.size / poolSize : 0,
  };
}

// ---------------------------------------------------------------------------
// Strategy Score
// ---------------------------------------------------------------------------

/**
 * A 0-100 composite describing ticket *construction quality*. It is explicitly
 * NOT a probability of winning — every combination in a game has identical odds,
 * and the UI never renders this with a % sign or the word "chance".
 *
 * On fixed-payout games the popularity component is dropped entirely (it cannot
 * matter), and the score reflects distribution balance only.
 */
export function scoreTicket(
  game: GameDefinition,
  numbers: number[],
  recentDraws: Draw[],
  batchSoFar: GeneratedTicket[] = [],
): StrategyScore {
  const components: ScoreComponent[] = [];
  const shared = game.payoutModel !== 'fixed';

  // --- Distribution balance ------------------------------------------------
  const odd = numbers.filter((n) => n % 2 === 1).length;
  const mid = (game.min + game.max) / 2;
  const high = numbers.filter((n) => n > mid).length;
  const idealSplit = game.pick / 2;
  const parityScore = 100 - (Math.abs(odd - idealSplit) / idealSplit) * 100;
  const rangeScore = 100 - (Math.abs(high - idealSplit) / idealSplit) * 100;

  let spreadScore = 100;
  if (game.kind === 'combination' && numbers.length > 1) {
    const s = [...numbers].sort((a, b) => a - b);
    const span = s[s.length - 1]! - s[0]!;
    const idealSpan = (game.max - game.min) * 0.75;
    spreadScore = 100 - clamp((Math.abs(span - idealSpan) / idealSpan) * 100, 0, 100);
  }

  const balance = (parityScore + rangeScore + spreadScore) / 3;
  components.push({
    key: 'balance',
    label: 'Distribution balance',
    value: clamp(balance, 0, 100),
    weight: shared ? 0.3 : 0.6,
    detail: `${odd} odd / ${game.pick - odd} even, ${high} high / ${game.pick - high} low.`,
  });

  // --- Popularity avoidance (shared-prize games only) ----------------------
  if (shared) {
    const pop = estimatePopularity(game, numbers, { recentDraws });
    components.push({
      key: 'unpopularity',
      label: 'Payout-sharing avoidance',
      value: clamp(100 - pop.index, 0, 100),
      weight: 0.45,
      detail: pop.summary,
    });
  }

  // --- Pattern non-triviality ---------------------------------------------
  const trivial = isTrivialPattern(game, numbers);
  components.push({
    key: 'pattern',
    label: 'Pattern distinctiveness',
    value: trivial ? 20 : 90,
    weight: shared ? 0.15 : 0.25,
    detail: trivial
      ? 'Matches an obvious pattern that many players also pick.'
      : 'No obvious sequence or playslip shape.',
  });

  // --- Batch contribution --------------------------------------------------
  let overlapValue = 100;
  let overlapDetail = 'First ticket in the batch.';
  if (batchSoFar.length > 0) {
    const mine = new Set(numbers);
    const overlaps = batchSoFar.map((t) => t.numbers.filter((n) => mine.has(n)).length);
    const avg = overlaps.reduce((a, b) => a + b, 0) / overlaps.length;
    overlapValue = clamp(100 - (avg / game.pick) * 100, 0, 100);
    overlapDetail = `Shares ${avg.toFixed(1)} numbers on average with the other tickets in this batch.`;
  }
  components.push({
    key: 'coverage',
    label: 'Batch coverage',
    value: overlapValue,
    weight: shared ? 0.1 : 0.15,
    detail: overlapDetail,
  });

  const total = clamp(
    components.reduce((s, c) => s + c.value * c.weight, 0),
    0,
    100,
  );

  const weakest = [...components].sort((a, b) => a.value - b.value)[0];
  const explanation = shared
    ? total >= 70
      ? 'Well-spread and unlikely to be widely picked — a good shape for a shared-prize game.'
      : `Reasonable ticket; ${weakest?.label.toLowerCase() ?? 'balance'} is the weakest factor.`
    : 'Balanced construction. On this game every combination has identical odds and an identical prize, so this score is presentational only.';

  return { total: Math.round(total), components, explanation };
}
