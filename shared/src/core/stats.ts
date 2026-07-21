/**
 * Descriptive statistics over draw history.
 *
 * Everything here is *descriptive*. None of it has predictive power on independent
 * draws, and the API surfaces that fact alongside the numbers (see `predictive`
 * on the returned payload). The genuinely useful outputs are the distribution
 * summaries, which feed the coverage and popularity models, and the observed-vs-
 * expected comparisons, which feed the randomness audit.
 */
import type { Draw, GameDefinition } from '../index.js';
import { matrixForDate, mean, stdev } from '../index.js';

export interface NumberStat {
  n: number;
  count: number;
  expected: number;
  /** (observed - expected) / sd, under the null that draws are uniform. */
  z: number;
  lastSeen: string | null;
  /** Draws since this number last appeared. */
  currentGap: number;
  averageGap: number | null;
  maxGap: number | null;
}

export interface DistributionBucket {
  label: string;
  value: number;
  count: number;
}

export interface GameStats {
  gameId: string;
  slot: string;
  drawCount: number;
  first: string | null;
  last: string | null;
  poolMin: number;
  poolMax: number;
  numbers: NumberStat[];
  hot: NumberStat[];
  cold: NumberStat[];
  overdue: NumberStat[];
  sums: { min: number; max: number; mean: number; stdev: number; histogram: DistributionBucket[] };
  oddEven: DistributionBucket[];
  highLow: DistributionBucket[];
  consecutive: DistributionBucket[];
  repeatsFromPrevious: DistributionBucket[];
  positions: Array<{ position: number; counts: DistributionBucket[] }>;
  topPairs: Array<{ a: number; b: number; count: number; expected: number }>;
  /** Always false. Present so no consumer can forget. */
  predictive: false;
  note: string;
  /** Which matrix era the figures cover, and how many draws were excluded. */
  era: { note: string; excludedDraws: number };
}

const STAT_NOTE =
  'Descriptive only. Lottery draws are independent, so none of these figures ' +
  'predict future results.';

/** Numbers in the pool that were valid for the most recent draw in the window. */
function poolFor(game: GameDefinition, draws: Draw[]): { min: number; max: number } {
  const latest = draws[draws.length - 1]?.drawDate;
  if (!latest) return { min: game.min, max: game.max };
  const m = matrixForDate(game, latest);
  return { min: m.min, max: m.max };
}

/**
 * Restrict to the current matrix era.
 *
 * Pooling eras silently corrupts every frequency figure. Fantasy 5 ran 5/26 until
 * 2001 and 5/36 after, so numbers 1-26 have six extra years of draws behind them;
 * counting the whole history makes low numbers look permanently "hot" and 27-36
 * permanently "cold" when nothing of the sort is happening. The same applies to
 * Powerball (5/59 before 2015) and Mega Millions (5/75, then +1/25).
 */
function currentEra(game: GameDefinition, ascending: Draw[]): { draws: Draw[]; note: string; excluded: number } {
  if (!game.matrixEras?.length) {
    return { draws: ascending, note: 'Single matrix throughout this game\'s history.', excluded: 0 };
  }
  const latest = game.matrixEras[game.matrixEras.length - 1]!;
  const kept = ascending.filter((d) => d.drawDate >= latest.from);
  const excluded = ascending.length - kept.length;
  return {
    draws: kept,
    note:
      excluded > 0
        ? `Limited to the current matrix (${latest.note}) from ${latest.from}. ${excluded.toLocaleString()} earlier draws are excluded — pooling different matrices would make numbers added later look artificially cold.`
        : `Current matrix (${latest.note}) covers the full history shown.`,
    excluded,
  };
}

export function computeStats(
  game: GameDefinition,
  slot: string,
  drawsDesc: Draw[],
  windowSize?: number,
): GameStats {
  // Work ascending — gaps and "draws since" are naturally chronological.
  const sortedAll = [...drawsDesc].sort((a, b) => a.drawDate.localeCompare(b.drawDate));
  const { draws: all, note: eraNote, excluded } = currentEra(game, sortedAll);
  const draws = windowSize && windowSize < all.length ? all.slice(all.length - windowSize) : all;
  const n = draws.length;
  const { min, max } = poolFor(game, draws);
  const poolSize = max - min + 1;

  // --- frequency, gaps ----------------------------------------------------
  const counts = new Map<number, number>();
  const lastIndex = new Map<number, number>();
  const gapLists = new Map<number, number[]>();

  for (let v = min; v <= max; v++) {
    counts.set(v, 0);
    gapLists.set(v, []);
  }

  draws.forEach((d, i) => {
    // A digit game can repeat a value within one draw; count each occurrence.
    for (const v of d.numbers) {
      counts.set(v, (counts.get(v) ?? 0) + 1);
      const prev = lastIndex.get(v);
      if (prev !== undefined) gapLists.get(v)?.push(i - prev);
      lastIndex.set(v, i);
    }
  });

  // Expected count per number, and the sd of that count under uniformity.
  const drawsPerTicket = game.pick;
  const pPerDraw = game.kind === 'digits' ? drawsPerTicket / 10 : drawsPerTicket / poolSize;
  const expected = n * pPerDraw;
  const sd = Math.sqrt(n * pPerDraw * (1 - pPerDraw)) || 1;

  const numbers: NumberStat[] = [];
  for (let v = min; v <= max; v++) {
    const count = counts.get(v) ?? 0;
    const li = lastIndex.get(v);
    const gaps = gapLists.get(v) ?? [];
    numbers.push({
      n: v,
      count,
      expected,
      z: (count - expected) / sd,
      lastSeen: li !== undefined ? draws[li]!.drawDate : null,
      currentGap: li !== undefined ? n - 1 - li : n,
      averageGap: gaps.length ? mean(gaps) : null,
      maxGap: gaps.length ? Math.max(...gaps) : null,
    });
  }

  const byCount = [...numbers].sort((a, b) => b.count - a.count);
  const byGap = [...numbers].sort((a, b) => b.currentGap - a.currentGap);

  // --- distributions ------------------------------------------------------
  const sums = draws.map((d) => d.numbers.reduce((s, x) => s + x, 0));
  const sumStats = {
    min: sums.length ? Math.min(...sums) : 0,
    max: sums.length ? Math.max(...sums) : 0,
    mean: mean(sums),
    stdev: stdev(sums),
    histogram: histogram(sums, 20),
  };

  const midpoint = (min + max) / 2;
  const oddCounts = new Map<number, number>();
  const highCounts = new Map<number, number>();
  const consecCounts = new Map<number, number>();
  const repeatCounts = new Map<number, number>();

  draws.forEach((d, i) => {
    const odd = d.numbers.filter((x) => x % 2 === 1).length;
    oddCounts.set(odd, (oddCounts.get(odd) ?? 0) + 1);

    const high = d.numbers.filter((x) => x > midpoint).length;
    highCounts.set(high, (highCounts.get(high) ?? 0) + 1);

    if (game.kind === 'combination') {
      const sorted = [...d.numbers].sort((a, b) => a - b);
      let runs = 0;
      for (let k = 1; k < sorted.length; k++) if (sorted[k]! === sorted[k - 1]! + 1) runs++;
      consecCounts.set(runs, (consecCounts.get(runs) ?? 0) + 1);

      const prev = draws[i - 1];
      if (prev) {
        const prevSet = new Set(prev.numbers);
        const rep = sorted.filter((x) => prevSet.has(x)).length;
        repeatCounts.set(rep, (repeatCounts.get(rep) ?? 0) + 1);
      }
    }
  });

  // --- positional ---------------------------------------------------------
  const positions: GameStats['positions'] = [];
  for (let p = 0; p < game.pick; p++) {
    const c = new Map<number, number>();
    for (const d of draws) {
      const v = d.numbers[p];
      if (v === undefined) continue;
      c.set(v, (c.get(v) ?? 0) + 1);
    }
    positions.push({
      position: p + 1,
      counts: [...c.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([label, count]) => ({ label: String(label), value: label, count })),
    });
  }

  // --- pair co-occurrence -------------------------------------------------
  const topPairs: GameStats['topPairs'] = [];
  if (game.kind === 'combination' && game.pick >= 2 && poolSize <= 100) {
    const pairCounts = new Map<number, number>();
    for (const d of draws) {
      const s = [...new Set(d.numbers)].sort((a, b) => a - b);
      for (let i = 0; i < s.length; i++) {
        for (let j = i + 1; j < s.length; j++) {
          const key = s[i]! * 1000 + s[j]!;
          pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
        }
      }
    }
    // Expected pair count under uniformity: n * C(pick,2) / C(pool,2)
    const pairsPerDraw = (game.pick * (game.pick - 1)) / 2;
    const totalPairs = (poolSize * (poolSize - 1)) / 2;
    const expectedPair = (n * pairsPerDraw) / totalPairs;
    for (const [key, count] of [...pairCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
      topPairs.push({ a: Math.floor(key / 1000), b: key % 1000, count, expected: expectedPair });
    }
  }

  return {
    gameId: game.id,
    slot,
    drawCount: n,
    first: draws[0]?.drawDate ?? null,
    last: draws[n - 1]?.drawDate ?? null,
    poolMin: min,
    poolMax: max,
    numbers,
    hot: byCount.slice(0, 10),
    cold: [...byCount].reverse().slice(0, 10),
    overdue: byGap.slice(0, 10),
    sums: sumStats,
    oddEven: toBuckets(oddCounts, (k) => `${k} odd / ${game.pick - k} even`),
    highLow: toBuckets(highCounts, (k) => `${k} high / ${game.pick - k} low`),
    consecutive: toBuckets(consecCounts, (k) => (k === 0 ? 'none' : `${k} adjacent pair${k > 1 ? 's' : ''}`)),
    repeatsFromPrevious: toBuckets(repeatCounts, (k) => `${k} repeated`),
    positions,
    topPairs,
    predictive: false,
    note: STAT_NOTE,
    era: { note: eraNote, excludedDraws: excluded },
  };
}

function toBuckets(m: Map<number, number>, label: (k: number) => string): DistributionBucket[] {
  return [...m.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([value, count]) => ({ label: label(value), value, count }));
}

function histogram(values: number[], bins: number): DistributionBucket[] {
  if (values.length === 0) return [];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (hi === lo) return [{ label: String(lo), value: lo, count: values.length }];
  const width = (hi - lo) / bins;
  const out: DistributionBucket[] = [];
  for (let i = 0; i < bins; i++) {
    const from = lo + i * width;
    const to = i === bins - 1 ? hi : from + width;
    const count = values.filter((v) => v >= from && (i === bins - 1 ? v <= to : v < to)).length;
    out.push({ label: `${Math.round(from)}–${Math.round(to)}`, value: Math.round((from + to) / 2), count });
  }
  return out;
}

/** Rolling frequency of each number across sequential windows, for trend charts. */
export function rollingFrequency(
  game: GameDefinition,
  drawsDesc: Draw[],
  windowSize: number,
  step: number,
): Array<{ endDate: string; counts: Record<number, number> }> {
  const all = [...drawsDesc].sort((a, b) => a.drawDate.localeCompare(b.drawDate));
  const out: Array<{ endDate: string; counts: Record<number, number> }> = [];
  for (let end = windowSize; end <= all.length; end += step) {
    const slice = all.slice(end - windowSize, end);
    const counts: Record<number, number> = {};
    for (const d of slice) for (const v of d.numbers) counts[v] = (counts[v] ?? 0) + 1;
    out.push({ endDate: slice[slice.length - 1]!.drawDate, counts });
  }
  return out;
}
