/**
 * Randomness audit.
 *
 * This is the one place in NumberIQ where history is used for genuine statistical
 * inference. We are not testing "which numbers will come up" — we are testing
 * whether the *drawing process itself* is consistent with uniform randomness.
 *
 * A significant result here would mean a biased machine (a real, if very unlikely,
 * finding). A non-significant result — which is what decades of Florida data
 * produce — is the most direct evidence available that hot/cold/overdue patterns
 * are noise, and it is presented to the user in exactly those terms.
 */
import type { Draw, GameDefinition } from '@numberiq/shared';
import { chiSquarePValue, matrixForDate, mean, normalTwoTailP, stdev } from '@numberiq/shared';

export interface RandomnessTest {
  name: string;
  statistic: number;
  df?: number;
  pValue: number;
  /** Interpreted at alpha = 0.01 to keep the multiple-comparison burden sane. */
  significant: boolean;
  interpretation: string;
  detail: string;
}

export interface RandomnessAudit {
  gameId: string;
  slot: string;
  drawCount: number;
  /** Restricted to draws under the current matrix — pooling eras invalidates the test. */
  eraNote: string;
  tests: RandomnessTest[];
  verdict: 'consistent_with_random' | 'anomaly_detected' | 'insufficient_data';
  summary: string;
}

const ALPHA = 0.01;

/**
 * Only draws under the current matrix are testable: pooling a 5/70+1/25 era with a
 * 5/70+1/24 era would manufacture a spurious deficit for ball 25.
 */
function currentEraDraws(game: GameDefinition, draws: Draw[]): { draws: Draw[]; note: string } {
  if (!game.matrixEras?.length) return { draws, note: 'Single matrix throughout.' };
  const latest = game.matrixEras[game.matrixEras.length - 1]!;
  const filtered = draws.filter((d) => d.drawDate >= latest.from);
  return {
    draws: filtered,
    note: `Restricted to the current matrix (${latest.note}), in effect since ${latest.from}.`,
  };
}

export function runRandomnessAudit(
  game: GameDefinition,
  slot: string,
  drawsDesc: Draw[],
): RandomnessAudit {
  const { draws: eraDraws, note } = currentEraDraws(game, drawsDesc);
  const draws = [...eraDraws].sort((a, b) => a.drawDate.localeCompare(b.drawDate));
  const n = draws.length;

  if (n < 100) {
    return {
      gameId: game.id, slot, drawCount: n, eraNote: note, tests: [],
      verdict: 'insufficient_data',
      summary: `Only ${n} draws available under the current matrix. At least 100 are needed before these tests say anything meaningful.`,
    };
  }

  const m = matrixForDate(game, draws[n - 1]!.drawDate);
  const tests: RandomnessTest[] = [];

  // --- 1. Frequency uniformity (chi-square goodness of fit) ---------------
  tests.push(frequencyChiSquare(game, draws, m.min, m.max));

  // --- 2. Positional uniformity (digit games) -----------------------------
  if (game.kind === 'digits') {
    for (let p = 0; p < game.pick; p++) tests.push(positionChiSquare(draws, p));
  }

  // --- 3. Serial correlation of draw sums ---------------------------------
  tests.push(serialCorrelation(draws));

  // --- 4. Runs test on sums above/below the median ------------------------
  tests.push(runsTest(draws));

  // --- 5. Repeat rate vs. expectation (combination games) -----------------
  if (game.kind === 'combination' && game.pick > 1) {
    tests.push(repeatRateTest(game, draws, m.max - m.min + 1));
  }

  const anomalies = tests.filter((t) => t.significant);
  const verdict = anomalies.length > 0 ? 'anomaly_detected' : 'consistent_with_random';

  const summary =
    verdict === 'consistent_with_random'
      ? `Across ${n.toLocaleString()} draws, every test is consistent with a fair, uniform random process. ` +
        `That is the expected result — and it is why frequency patterns in the history have no predictive value.`
      : `${anomalies.length} of ${tests.length} tests flagged at the 1% level (${anomalies
          .map((a) => a.name)
          .join(', ')}). With ${tests.length} tests run, roughly ${(tests.length * ALPHA).toFixed(2)} ` +
        `false positives are expected by chance alone, so treat this as a prompt to look closer, not as proof of bias.`;

  return { gameId: game.id, slot, drawCount: n, eraNote: note, tests, verdict, summary };
}

function frequencyChiSquare(
  game: GameDefinition,
  draws: Draw[],
  min: number,
  max: number,
): RandomnessTest {
  const counts = new Map<number, number>();
  for (let v = min; v <= max; v++) counts.set(v, 0);
  let total = 0;
  for (const d of draws) {
    for (const v of d.numbers) {
      if (v < min || v > max) continue;
      counts.set(v, (counts.get(v) ?? 0) + 1);
      total++;
    }
  }
  const k = max - min + 1;
  const expected = total / k;
  let chi2 = 0;
  for (const c of counts.values()) chi2 += (c - expected) ** 2 / expected;
  const df = k - 1;
  const p = chiSquarePValue(chi2, df);

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const most = sorted[0]!;
  const least = sorted[sorted.length - 1]!;

  return {
    name: 'Frequency uniformity',
    statistic: chi2,
    df,
    pValue: p,
    significant: p < ALPHA,
    interpretation:
      p < ALPHA
        ? 'Number frequencies deviate from uniform more than chance comfortably explains.'
        : 'Number frequencies are indistinguishable from uniform random.',
    detail:
      `Most drawn: ${most[0]} (${most[1]}x). Least drawn: ${least[0]} (${least[1]}x). ` +
      `Expected ${expected.toFixed(1)}x each. A spread of this size is normal — ` +
      `random data always produces a "hottest" and a "coldest" number.`,
  };
}

function positionChiSquare(draws: Draw[], position: number): RandomnessTest {
  const counts = new Array(10).fill(0);
  let total = 0;
  for (const d of draws) {
    const v = d.numbers[position];
    if (v === undefined || v < 0 || v > 9) continue;
    counts[v]++;
    total++;
  }
  const expected = total / 10;
  let chi2 = 0;
  for (const c of counts) chi2 += (c - expected) ** 2 / expected;
  const p = chiSquarePValue(chi2, 9);
  return {
    name: `Digit uniformity, position ${position + 1}`,
    statistic: chi2,
    df: 9,
    pValue: p,
    significant: p < ALPHA,
    interpretation:
      p < ALPHA
        ? `Digit distribution in position ${position + 1} deviates from uniform.`
        : `Digits in position ${position + 1} are uniformly distributed.`,
    detail: `Counts 0-9: ${counts.join(', ')} (expected ${expected.toFixed(1)} each).`,
  };
}

/**
 * Lag-1 serial correlation of draw sums. If draws were influenced by the previous
 * draw, this is where it would show. Under independence r ~ N(0, 1/sqrt(n)).
 */
function serialCorrelation(draws: Draw[]): RandomnessTest {
  const sums = draws.map((d) => d.numbers.reduce((s, x) => s + x, 0));
  const n = sums.length - 1;
  const a = sums.slice(0, -1);
  const b = sums.slice(1);
  const ma = mean(a);
  const mb = mean(b);
  const sa = stdev(a);
  const sb = stdev(b);

  let cov = 0;
  for (let i = 0; i < n; i++) cov += (a[i]! - ma) * (b[i]! - mb);
  const r = sa && sb ? cov / (n - 1) / (sa * sb) : 0;
  const z = r * Math.sqrt(n);
  const p = normalTwoTailP(z);

  return {
    name: 'Serial independence (lag-1)',
    statistic: r,
    pValue: p,
    significant: p < ALPHA,
    interpretation:
      p < ALPHA
        ? 'Consecutive draws show correlation — draws may not be independent.'
        : 'Consecutive draws are uncorrelated, as independent draws should be.',
    detail: `Correlation between each draw's sum and the next: r = ${r.toFixed(4)} (0 expected).`,
  };
}

/** Wald-Wolfowitz runs test on whether each draw's sum is above or below the median. */
function runsTest(draws: Draw[]): RandomnessTest {
  const sums = draws.map((d) => d.numbers.reduce((s, x) => s + x, 0));
  const sorted = [...sums].sort((x, y) => x - y);
  const median = sorted[Math.floor(sorted.length / 2)]!;

  const signs = sums.filter((s) => s !== median).map((s) => s > median);
  const n1 = signs.filter(Boolean).length;
  const n2 = signs.length - n1;
  if (n1 === 0 || n2 === 0) {
    return {
      name: 'Runs test (sums)', statistic: 0, pValue: 1, significant: false,
      interpretation: 'Not enough variation to test.', detail: '',
    };
  }

  let runs = 1;
  for (let i = 1; i < signs.length; i++) if (signs[i] !== signs[i - 1]) runs++;

  const expected = (2 * n1 * n2) / (n1 + n2) + 1;
  const variance =
    (2 * n1 * n2 * (2 * n1 * n2 - n1 - n2)) / ((n1 + n2) ** 2 * (n1 + n2 - 1));
  const z = variance > 0 ? (runs - expected) / Math.sqrt(variance) : 0;
  const p = normalTwoTailP(z);

  return {
    name: 'Runs test (sums)',
    statistic: z,
    pValue: p,
    significant: p < ALPHA,
    interpretation:
      p < ALPHA
        ? 'Sums cluster or alternate more than chance explains.'
        : 'No streaking or alternation beyond what randomness produces.',
    detail: `${runs} runs observed, ${expected.toFixed(1)} expected (z = ${z.toFixed(2)}).`,
  };
}

/** How often numbers repeat from the immediately preceding draw, vs. expectation. */
function repeatRateTest(game: GameDefinition, draws: Draw[], poolSize: number): RandomnessTest {
  let repeats = 0;
  let comparisons = 0;
  for (let i = 1; i < draws.length; i++) {
    const prev = new Set(draws[i - 1]!.numbers);
    repeats += draws[i]!.numbers.filter((v) => prev.has(v)).length;
    comparisons++;
  }
  const observedRate = repeats / comparisons;
  const expectedRate = (game.pick * game.pick) / poolSize;
  const sd = Math.sqrt((game.pick * (game.pick / poolSize) * (1 - game.pick / poolSize)) / comparisons);
  const z = sd > 0 ? (observedRate - expectedRate) / sd : 0;
  const p = normalTwoTailP(z);

  return {
    name: 'Repeat rate from previous draw',
    statistic: observedRate,
    pValue: p,
    significant: p < ALPHA,
    interpretation:
      p < ALPHA
        ? 'Numbers repeat between consecutive draws at an unexpected rate.'
        : 'Numbers repeat between draws exactly as often as chance predicts.',
    detail:
      `${observedRate.toFixed(3)} numbers repeat per draw on average; ` +
      `${expectedRate.toFixed(3)} expected under independence.`,
  };
}
