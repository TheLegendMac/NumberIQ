import type { GameDefinition, GameId, StrategyDefinition } from './types.js';

/**
 * Game registry — official rules, matrices and odds.
 *
 * Odds are computed from the game matrix and cross-checked against the Florida Lottery's
 * published overall odds (see games.test.ts, which recomputes every tier from first
 * principles and asserts the published overall figure). Where a prize is pari-mutuel we
 * carry `estimated: true` rather than inventing a posted amount.
 */

const PICK_SLOTS = ['midday', 'evening'];
const PICK_SLOT_LABELS = { midday: 'Midday', evening: 'Evening' };

/** Pick N games: N independent digits 0-9, straight play. Fixed payout, 50% RTP. */
function pickGame(
  n: 2 | 3 | 4 | 5,
  straightPrize: number,
  sourceFile: string,
): GameDefinition {
  const oneIn = 10 ** n;
  return {
    id: `pick${n}` as GameId,
    name: `Pick ${n}`,
    shortName: `P${n}`,
    payoutModel: 'fixed',
    kind: 'digits',
    pick: n,
    min: 0,
    max: 9,
    slots: PICK_SLOTS,
    slotLabels: PICK_SLOT_LABELS,
    basePrice: 1,
    topPrizeOneIn: oneIn,
    overallOneIn: oneIn,
    prizeTiers: [
      { match: n, label: 'Straight', prize: straightPrize, oneIn, isJackpot: true },
    ],
    sourceFile,
    drawsPerWeek: 14,
    notes:
      'Fixed payout. Straight play at $1. Odds and prize are identical for every ' +
      'combination, so no selection method can change expected value. Box/combo plays ' +
      'and Fireball are not modelled.',
  };
}

export const GAMES: Record<GameId, GameDefinition> = {
  pick2: pickGame(2, 50, 'p2'),
  pick3: pickGame(3, 500, 'p3'),
  pick4: pickGame(4, 5000, 'p4'),
  pick5: pickGame(5, 50000, 'p5'),

  cashpop: {
    id: 'cashpop',
    name: 'Cash Pop',
    shortName: 'CP',
    payoutModel: 'fixed',
    kind: 'combination',
    pick: 1,
    min: 1,
    max: 15,
    slots: ['morning', 'matinee', 'afternoon', 'evening', 'late_night'],
    slotLabels: {
      morning: 'Morning',
      matinee: 'Matinee',
      afternoon: 'Afternoon',
      evening: 'Evening',
      late_night: 'Late Night',
    },
    basePrice: 1,
    topPrizeOneIn: 15,
    overallOneIn: 15,
    prizeTiers: [
      { match: 1, label: 'Match', prize: null, oneIn: 15, estimated: true, isJackpot: true },
    ],
    sourceFile: 'cp',
    drawsPerWeek: 35,
    notes:
      'Fixed payout. One number from 1-15, five draws daily. The prize multiplier ' +
      '(5x-250x) is assigned to the number at purchase, so payout varies per ticket ' +
      'independently of which number you pick. No selection method can change expected value.',
  },

  fantasy5: {
    id: 'fantasy5',
    name: 'Fantasy 5',
    shortName: 'F5',
    payoutModel: 'parimutuel',
    kind: 'combination',
    pick: 5,
    min: 1,
    max: 36,
    slots: ['midday', 'evening'],
    slotLabels: PICK_SLOT_LABELS,
    basePrice: 1,
    topPrizeOneIn: 376_992,
    overallOneIn: 7.6,
    prizeTiers: [
      { match: 5, label: '5 of 5', prize: null, oneIn: 376_992, estimated: true, isJackpot: true },
      { match: 4, label: '4 of 5', prize: 106, oneIn: 2_432.2, estimated: true },
      { match: 3, label: '3 of 5', prize: 10.5, oneIn: 81.1, estimated: true },
      { match: 2, label: '2 of 5', prize: 1, oneIn: 8.4, estimated: true },
    ],
    sourceFile: 'ff',
    drawsPerWeek: 14,
    matrixEras: [
      { from: '1988-01-01', max: 26, note: 'Original Fantasy 5, 5/26' },
      { from: '2001-07-16', max: 36, note: '5/36' },
    ],
    notes:
      'Fully pari-mutuel: every tier is split among that tier\'s winners. Avoiding ' +
      'commonly-picked numbers genuinely raises your expected payout if you win. ' +
      'Prize figures shown are historical averages, not guarantees.',
  },

  cash4life: {
    id: 'cash4life',
    name: 'Cash4Life',
    shortName: 'C4L',
    payoutModel: 'split_jackpot',
    kind: 'combination',
    pick: 5,
    min: 1,
    max: 60,
    extraBall: { key: 'cashBall', label: 'Cash Ball', min: 1, max: 4 },
    slots: ['main'],
    basePrice: 2,
    topPrizeOneIn: 21_846_048,
    overallOneIn: 7.76,
    prizeTiers: [
      { match: 5, extra: true, label: '$1,000/day for life', prize: null, oneIn: 21_846_048, isJackpot: true },
      { match: 5, extra: false, label: '$1,000/week for life', prize: null, oneIn: 7_282_016 },
      { match: 4, extra: true, label: '4 + Cash Ball', prize: 2500, oneIn: 79_440 },
      { match: 4, extra: false, label: '4 of 5', prize: 500, oneIn: 26_480 },
      { match: 3, extra: true, label: '3 + Cash Ball', prize: 100, oneIn: 1_471 },
      { match: 3, extra: false, label: '3 of 5', prize: 25, oneIn: 490.3 },
      { match: 2, extra: true, label: '2 + Cash Ball', prize: 10, oneIn: 83.3 },
      { match: 2, extra: false, label: '2 of 5', prize: 4, oneIn: 27.8 },
      { match: 1, extra: true, label: '1 + Cash Ball', prize: 2, oneIn: 12.8 },
    ],
    sourceFile: 'c4l',
    drawsPerWeek: 7,
    retiredOn: '2026-02-21',
    retiredNote:
      'Cash4Life held its final drawing on 21 February 2026 and has been retired ' +
      'across all participating states. The history below is complete and closed; ' +
      'the game can no longer be played.',
    notes:
      'Lower tiers are fixed. The lifetime top prizes are shared if multiple winners ' +
      'hit them, so selection has a marginal effect at the top tiers only.',
  },

  lotto: {
    id: 'lotto',
    name: 'Florida Lotto',
    shortName: 'LOTTO',
    payoutModel: 'parimutuel',
    kind: 'combination',
    pick: 6,
    min: 1,
    max: 53,
    slots: ['main', 'double_play'],
    basePrice: 2,
    topPrizeOneIn: 22_957_480,
    overallOneIn: 69.7,
    slotLabels: { main: 'Main Draw', double_play: 'Double Play' },
    prizeTiers: [
      { match: 6, label: '6 of 6', prize: null, oneIn: 22_957_480, estimated: true, isJackpot: true },
      { match: 5, label: '5 of 6', prize: 4500, oneIn: 81_409.5, estimated: true },
      { match: 4, label: '4 of 6', prize: 70, oneIn: 1_415.9, estimated: true },
      { match: 3, label: '3 of 6', prize: 5, oneIn: 70.8 },
    ],
    sourceFile: 'l6',
    drawsPerWeek: 2,
    matrixEras: [
      { from: '1988-04-29', max: 49, note: 'Original Florida Lotto, 6/49' },
      { from: '1999-10-24', max: 53, note: '6/53' },
    ],
    notes:
      'Pari-mutuel jackpot and mid tiers. Double Play draws are ingested as a separate ' +
      'slot. Prize figures above the 3-match tier are historical averages.',
  },

  jackpot_triple_play: {
    id: 'jackpot_triple_play',
    name: 'Jackpot Triple Play',
    shortName: 'JTP',
    payoutModel: 'parimutuel',
    kind: 'combination',
    pick: 6,
    min: 1,
    max: 46,
    slots: ['main'],
    basePrice: 1,
    topPrizeOneIn: 9_366_819,
    overallOneIn: 42.4,
    prizeTiers: [
      { match: 6, label: '6 of 6', prize: null, oneIn: 9_366_819, estimated: true, isJackpot: true },
      { match: 5, label: '5 of 6', prize: 1000, oneIn: 39_028.4, estimated: true },
      { match: 4, label: '4 of 6', prize: 40, oneIn: 800.6, estimated: true },
      { match: 3, label: '3 of 6', prize: 1, oneIn: 47.4 },
    ],
    sourceFile: 'jtp',
    drawsPerWeek: 2,
    notes: 'Pari-mutuel. Each ticket includes three sets of numbers; NumberIQ models one set.',
  },

  megamillions: {
    id: 'megamillions',
    name: 'Mega Millions',
    shortName: 'MM',
    payoutModel: 'split_jackpot',
    kind: 'combination',
    pick: 5,
    min: 1,
    max: 70,
    extraBall: { key: 'megaBall', label: 'Mega Ball', min: 1, max: 24 },
    slots: ['main'],
    basePrice: 5,
    topPrizeOneIn: 290_472_336,
    overallOneIn: 23.07,
    prizeTiers: [
      { match: 5, extra: true, label: 'Jackpot', prize: null, oneIn: 290_472_336, isJackpot: true },
      { match: 5, extra: false, label: '5 of 5', prize: 1_000_000, oneIn: 12_629_232 },
      { match: 4, extra: true, label: '4 + Mega Ball', prize: 10_000, oneIn: 893_761 },
      { match: 4, extra: false, label: '4 of 5', prize: 500, oneIn: 38_859 },
      { match: 3, extra: true, label: '3 + Mega Ball', prize: 200, oneIn: 13_965 },
      { match: 3, extra: false, label: '3 of 5', prize: 10, oneIn: 607.2 },
      { match: 2, extra: true, label: '2 + Mega Ball', prize: 10, oneIn: 665.0 },
      { match: 1, extra: true, label: '1 + Mega Ball', prize: 4, oneIn: 85.8 },
      { match: 0, extra: true, label: 'Mega Ball only', prize: 2, oneIn: 35.2 },
    ],
    sourceFile: 'mmil',
    drawsPerWeek: 2,
    matrixEras: [
      { from: '1988-01-01', max: 56, extraMax: 46, note: 'The Big Game / early Mega Millions, 5/56 + 1/46' },
      { from: '2013-10-22', max: 75, extraMax: 15, note: '5/75 + 1/15' },
      { from: '2017-10-28', max: 70, extraMax: 25, note: '5/70 + 1/25' },
      { from: '2025-04-08', max: 70, extraMax: 24, note: '5/70 + 1/24, $5 ticket with built-in multiplier' },
    ],
    notes:
      'Every ticket carries a random 2x-10x multiplier on non-jackpot prizes, so realised ' +
      'EV is higher than the base prizes shown. The jackpot is split among jackpot winners.',
  },

  powerball: {
    id: 'powerball',
    name: 'Powerball',
    shortName: 'PB',
    payoutModel: 'split_jackpot',
    kind: 'combination',
    pick: 5,
    min: 1,
    max: 69,
    extraBall: { key: 'powerball', label: 'Powerball', min: 1, max: 26 },
    slots: ['main', 'double_play'],
    slotLabels: { main: 'Main Draw', double_play: 'Double Play' },
    basePrice: 2,
    topPrizeOneIn: 292_201_338,
    overallOneIn: 24.87,
    prizeTiers: [
      { match: 5, extra: true, label: 'Jackpot', prize: null, oneIn: 292_201_338, isJackpot: true },
      { match: 5, extra: false, label: '5 of 5', prize: 1_000_000, oneIn: 11_688_053.5 },
      { match: 4, extra: true, label: '4 + Powerball', prize: 50_000, oneIn: 913_129.2 },
      { match: 4, extra: false, label: '4 of 5', prize: 100, oneIn: 36_525.2 },
      { match: 3, extra: true, label: '3 + Powerball', prize: 100, oneIn: 14_494.1 },
      { match: 3, extra: false, label: '3 of 5', prize: 7, oneIn: 579.8 },
      { match: 2, extra: true, label: '2 + Powerball', prize: 7, oneIn: 701.3 },
      { match: 1, extra: true, label: '1 + Powerball', prize: 4, oneIn: 91.98 },
      { match: 0, extra: true, label: 'Powerball only', prize: 4, oneIn: 38.32 },
    ],
    sourceFile: 'pb',
    drawsPerWeek: 3,
    matrixEras: [
      { from: '1988-01-01', max: 59, extraMax: 39, note: 'Pre-2012 Powerball, 5/59 + 1/39' },
      { from: '2012-01-15', max: 59, extraMax: 35, note: '5/59 + 1/35' },
      { from: '2015-10-07', max: 69, extraMax: 26, note: '5/69 + 1/26' },
    ],
    notes:
      'Double Play draws are ingested as a separate slot. The jackpot is split among ' +
      'jackpot winners, so avoiding popular combinations raises expected payout if you win.',
  },
};

export const GAME_LIST: GameDefinition[] = Object.values(GAMES);

export function getGame(id: GameId): GameDefinition {
  const g = GAMES[id];
  if (!g) throw new Error(`Unknown game: ${id}`);
  return g;
}

export function isGameId(v: unknown): v is GameId {
  return typeof v === 'string' && v in GAMES;
}

export interface EffectiveMatrix {
  min: number;
  max: number;
  extraMin: number | null;
  extraMax: number | null;
  /** Label of the era in effect, for display. */
  era: string;
}

/**
 * The matrix actually in effect on a given draw date. Historical draws must be
 * validated and analysed against the matrix that was live when they were drawn —
 * see MatrixEra in types.ts for why.
 */
export function matrixForDate(g: GameDefinition, isoDate: string): EffectiveMatrix {
  const current: EffectiveMatrix = {
    min: g.min,
    max: g.max,
    extraMin: g.extraBall?.min ?? null,
    extraMax: g.extraBall?.max ?? null,
    era: 'current',
  };
  if (!g.matrixEras?.length) return current;

  let active: (typeof g.matrixEras)[number] | undefined;
  for (const era of g.matrixEras) {
    if (isoDate >= era.from) active = era;
  }
  if (!active) return current;

  return {
    min: g.min,
    max: active.max,
    extraMin: g.extraBall ? g.extraBall.min : null,
    extraMax: active.extraMax ?? (g.extraBall ? g.extraBall.max : null),
    era: active.note,
  };
}

/** Games where number selection can legitimately affect expected value. */
export function hasSharedPrizes(g: GameDefinition): boolean {
  return g.payoutModel !== 'fixed';
}

/**
 * Expected value of one base-price ticket, from posted prize amounts only.
 * Returns null when the dominant tiers are pari-mutuel/jackpot and no honest
 * point estimate exists — we decline rather than invent one.
 */
export function expectedValuePerTicket(g: GameDefinition): number | null {
  let ev = 0;
  let unknown = false;
  for (const t of g.prizeTiers) {
    if (t.prize === null) { unknown = true; continue; }
    ev += t.prize / t.oneIn;
  }
  // Fixed games are fully determined; report exactly.
  if (!unknown) return ev;
  // Otherwise the known tiers give a *lower bound* only.
  return null;
}

/** Lower bound on EV from the fixed tiers alone (excludes jackpot/pari-mutuel tiers). */
export function evLowerBound(g: GameDefinition): number {
  return g.prizeTiers.reduce((s, t) => (t.prize === null ? s : s + t.prize / t.oneIn), 0);
}

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

export const STRATEGIES: StrategyDefinition[] = [
  {
    id: 'unpopular',
    name: 'Unpopular Numbers',
    class: 'ev_positive',
    description:
      'Avoids the number patterns other players pick most — birthdays, low numbers, ' +
      'lucky 7, straight lines on the playslip, arithmetic runs.',
    disclosure:
      'Does not change your odds of winning. In shared-prize games it raises how much ' +
      'you would collect if you win, by reducing the chance of splitting with others.',
    requiresSharedPrizes: true,
  },
  {
    id: 'balanced',
    name: 'Balanced',
    class: 'ev_positive',
    description:
      'Combines statistical spread (odd/even, high/low, sum near centre, no trivial ' +
      'patterns) with moderate popularity avoidance.',
    disclosure:
      'Does not change your odds of winning. Produces well-distributed tickets and, in ' +
      'shared-prize games, modestly improves expected payout.',
  },
  {
    id: 'random',
    name: 'Pure Random',
    class: 'neutral',
    description: 'Uniform random selection. The mathematical baseline every other mode is measured against.',
    disclosure: 'Every combination is equally likely. This is the honest default.',
  },
  {
    id: 'hot',
    name: 'Hot Numbers',
    class: 'cosmetic',
    description: 'Favours numbers drawn most often in the selected recent window.',
    disclosure:
      'Draws are independent, so this does not change your odds or your expected value. ' +
      'Included because people want it — run a backtest to see it land inside the random band.',
  },
  {
    id: 'cold',
    name: 'Cold Numbers',
    class: 'cosmetic',
    description: 'Favours numbers drawn least often in the selected recent window.',
    disclosure:
      'Draws are independent, so this does not change your odds or your expected value. ' +
      'Included because people want it — run a backtest to see it land inside the random band.',
  },
  {
    id: 'overdue',
    name: 'Overdue',
    class: 'cosmetic',
    description: 'Favours numbers with the longest gap since their last appearance.',
    disclosure:
      'This is the gambler\'s fallacy: a number that has not appeared is not "due". ' +
      'It does not change your odds or expected value.',
  },
  {
    id: 'frequency_weighted',
    name: 'Frequency Weighted',
    class: 'cosmetic',
    description: 'Samples numbers with probability proportional to historical frequency.',
    disclosure:
      'Historical frequency has no predictive power on independent draws. Does not change ' +
      'your odds or expected value.',
  },
  {
    id: 'contrarian',
    name: 'Contrarian',
    class: 'cosmetic',
    description: 'Inverts historical frequency — favours the least-drawn numbers overall.',
    disclosure:
      'Historical frequency has no predictive power on independent draws. Does not change ' +
      'your odds or expected value.',
  },
];

export const STRATEGY_BY_ID = new Map(STRATEGIES.map((s) => [s.id, s]));

/** Strategies offered for a given game — EV-positive modes are hidden on fixed-payout games. */
export function strategiesForGame(g: GameDefinition): StrategyDefinition[] {
  if (hasSharedPrizes(g)) return STRATEGIES;
  return STRATEGIES.filter((s) => !s.requiresSharedPrizes);
}
