/**
 * Player-popularity model.
 *
 * This is the only component in NumberIQ that can legitimately improve a user's
 * expected value — and it does so WITHOUT changing the probability of winning.
 *
 * The mechanism: players do not choose uniformly. In games where a prize tier is
 * split among its winners (pari-mutuel tiers, shared jackpots), picking a
 * combination that few others picked means a larger share if it hits. P(win) is
 * untouched; E[payout | win] rises.
 *
 * IMPORTANT — this is a MODEL, not measurement. Florida does not publish
 * per-combination sales data, so these weights come from the published literature
 * on lottery number selection (Chernoff 1981 on Massachusetts numbers games;
 * Ziemba et al. 1986 on Lotto 6/49; Cook & Clotfelter 1993 on conscious selection)
 * rather than from Florida sales. They are directionally well-supported and
 * uncalibrated in magnitude. Every consumer surfaces it as an estimate.
 *
 * On fixed-payout games (Pick 2-5, Cash Pop) this model is not applied at all,
 * because prizes there are posted amounts that are never split.
 */
import type { Draw, GameDefinition } from '@numberiq/shared';
import { clamp } from '@numberiq/shared';

export interface PopularityFactor {
  key: string;
  label: string;
  /** Multiplier applied to the combination's estimated pick-rate. >1 = more popular. */
  multiplier: number;
  detail: string;
}

export interface PopularityEstimate {
  /** 0-100. Higher means more players are estimated to have picked this. */
  index: number;
  factors: PopularityFactor[];
  /** Plain-language summary of the dominant effect. */
  summary: string;
}

/**
 * Relative pick-rate weight for a single number, versus a uniform baseline of 1.0.
 * Calendar bias is by far the strongest documented effect.
 */
export function numberPopularityWeight(n: number): number {
  let w = 1.0;
  if (n >= 1 && n <= 31) {
    w *= 1.65;                       // birthdays, anniversaries — the dominant bias
    if (n <= 12) w *= 1.18;          // month numbers get an extra lift
  } else {
    w *= 0.62;                       // 32+ is structurally under-picked
  }
  if (n === 7) w *= 1.30;            // "lucky" 7
  if (n === 3 || n === 11 || n === 21) w *= 1.08;
  if (n === 13) w *= 0.80;           // avoided as unlucky — good for us
  return w;
}

/** Mean weight across the pool, used to normalise a combination's score. */
function baselineWeight(min: number, max: number): number {
  let s = 0;
  for (let v = min; v <= max; v++) s += numberPopularityWeight(v);
  return s / (max - min + 1);
}

function isArithmetic(sorted: number[]): boolean {
  if (sorted.length < 3) return false;
  const step = sorted[1]! - sorted[0]!;
  if (step === 0) return false;
  return sorted.every((v, i) => i === 0 || v - sorted[i - 1]! === step);
}

function longestConsecutiveRun(sorted: number[]): number {
  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]! === sorted[i - 1]! + 1) run++;
    else run = 1;
    if (run > best) best = run;
  }
  return best;
}

/**
 * Playslip geometry. Slips lay numbers out in a grid (conventionally 5 or 10 per
 * row), and players draw lines, columns and other shapes on them. Combinations
 * that land in a single row or column are heavily over-picked.
 */
function geometryMultiplier(sorted: number[], columns: number): { mult: number; detail: string } {
  const rows = new Set(sorted.map((n) => Math.floor((n - 1) / columns)));
  const cols = new Set(sorted.map((n) => (n - 1) % columns));
  if (cols.size === 1) return { mult: 1.9, detail: `all in column ${[...cols][0]! + 1} of the playslip` };
  if (rows.size === 1) return { mult: 1.7, detail: 'all on one playslip row' };
  if (cols.size <= Math.ceil(sorted.length / 2)) {
    return { mult: 1.25, detail: 'clustered into few playslip columns' };
  }
  return { mult: 1, detail: '' };
}

export interface PopularityContext {
  /** Recent winning combinations — a real share of players replay them. */
  recentDraws?: Draw[];
}

export function estimatePopularity(
  game: GameDefinition,
  numbers: number[],
  ctx: PopularityContext = {},
): PopularityEstimate {
  // Fixed-payout games never split a prize, so popularity is irrelevant by construction.
  if (game.payoutModel === 'fixed') {
    return {
      index: 50,
      factors: [],
      summary:
        `${game.name} pays posted amounts that are never split between winners, ` +
        `so how many other people picked your numbers has no effect at all.`,
    };
  }

  const sorted = [...numbers].sort((a, b) => a - b);
  const factors: PopularityFactor[] = [];

  // 1. Per-number calendar / lucky-number bias
  const base = baselineWeight(game.min, game.max);
  const avgWeight = sorted.reduce((s, n) => s + numberPopularityWeight(n), 0) / sorted.length;
  const calendarMult = avgWeight / base;
  const under31 = sorted.filter((n) => n <= 31).length;
  factors.push({
    key: 'calendar',
    label: 'Calendar & lucky-number bias',
    multiplier: calendarMult,
    detail:
      game.max > 31
        ? `${under31} of ${sorted.length} numbers fall in 1-31, the range players over-pick for birthdays.`
        : `Pool tops out at ${game.max}, so calendar bias affects most combinations similarly.`,
  });

  // 2. Arithmetic sequences
  if (isArithmetic(sorted)) {
    factors.push({
      key: 'arithmetic',
      label: 'Arithmetic sequence',
      multiplier: 3.2,
      detail: `${sorted.join('-')} is an even-step sequence; these are picked far more than chance.`,
    });
  }

  // 3. Consecutive runs
  const run = longestConsecutiveRun(sorted);
  if (run >= 3) {
    factors.push({
      key: 'consecutive',
      label: 'Consecutive run',
      multiplier: 1 + (run - 2) * 0.5,
      detail: `Contains a run of ${run} consecutive numbers.`,
    });
  }

  // 4. Playslip geometry
  if (game.kind === 'combination' && game.max >= 20) {
    const geo = geometryMultiplier(sorted, 10);
    if (geo.mult > 1) {
      factors.push({
        key: 'geometry',
        label: 'Playslip pattern',
        multiplier: geo.mult,
        detail: `Numbers are ${geo.detail} — visually patterned picks are over-chosen.`,
      });
    }
  }

  // 5. Sum clustering — hand-picked tickets bunch near the centre of the sum range
  const sum = sorted.reduce((s, n) => s + n, 0);
  const centre = (sorted.length * (game.min + game.max)) / 2;
  const spread = Math.sqrt(sorted.length) * (game.max - game.min) * 0.22;
  const sumZ = spread > 0 ? Math.abs(sum - centre) / spread : 0;
  if (sumZ < 0.5) {
    factors.push({
      key: 'sum_centre',
      label: 'Central sum',
      multiplier: 1.15,
      detail: `Sum of ${sum} sits near the middle of the range, where hand-picked tickets cluster.`,
    });
  }

  // 6. Replaying a recent winning combination
  if (ctx.recentDraws?.length) {
    const key = sorted.join(',');
    const match = ctx.recentDraws.find((d) => [...d.numbers].sort((a, b) => a - b).join(',') === key);
    if (match) {
      factors.push({
        key: 'recent_winner',
        label: 'Recent winning combination',
        multiplier: 2.5,
        detail: `This exact combination was drawn on ${match.drawDate}; many players replay recent winners.`,
      });
    }
  }

  // 7. All numbers in the same decade
  const decades = new Set(sorted.map((n) => Math.floor(n / 10)));
  if (decades.size === 1 && sorted.length >= 4) {
    factors.push({
      key: 'single_decade',
      label: 'Single decade',
      multiplier: 1.4,
      detail: 'Every number shares one decade — a common hand-picked shape.',
    });
  }

  const combined = factors.reduce((m, f) => m * f.multiplier, 1);
  // Map the multiplier onto 0-100 with 1.0 (average popularity) landing at 50.
  const index = clamp(50 * Math.pow(combined, 0.75), 1, 99);

  const dominant = [...factors].sort((a, b) => b.multiplier - a.multiplier)[0];
  const summary =
    index >= 65
      ? `Likely picked by many other players${dominant ? ` — ${dominant.label.toLowerCase()}` : ''}. If this wins a shared tier, expect to split it.`
      : index <= 35
        ? 'Unlikely to be widely picked, so a shared-tier win would be split with fewer people.'
        : 'Around average popularity.';

  return { index, factors, summary };
}

/** Convenience inverse: 0-100 where higher is better for the player. */
export function unpopularityScore(est: PopularityEstimate): number {
  return 100 - est.index;
}
