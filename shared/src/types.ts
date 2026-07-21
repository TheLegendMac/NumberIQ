/** Core domain types shared by server and web. */

/**
 * How a game pays. This single field decides whether *any* selection strategy can
 * legitimately affect expected value — see docs/PHASE-1-AUDIT.md §2.1.
 *
 * - `fixed`        Posted prize amounts. Number choice CANNOT change EV. Ever.
 * - `parimutuel`   Prize pool split among winners in a tier. Unpopular picks raise E[payout | win].
 * - `split_jackpot` Fixed lower tiers, but the jackpot is divided among jackpot winners.
 */
export type PayoutModel = 'fixed' | 'parimutuel' | 'split_jackpot';

export type GameId =
  | 'pick2' | 'pick3' | 'pick4' | 'pick5'
  | 'fantasy5' | 'cashpop' | 'cash4life'
  | 'lotto' | 'jackpot_triple_play'
  | 'megamillions' | 'powerball';

/** A named drawing slot within a day (Pick games and Cash Pop draw more than once daily). */
export type DrawSlot = string;

/** A secondary ball drawn from its own pool (Powerball, Mega Ball, Cash Ball). */
export interface ExtraBall {
  key: string;
  label: string;
  min: number;
  max: number;
}

export interface PrizeTier {
  /** Main numbers matched. */
  match: number;
  /** Whether the extra ball must also match. `undefined` = game has no extra ball. */
  extra?: boolean;
  label: string;
  /** Fixed prize in dollars, or null when pari-mutuel / jackpot. */
  prize: number | null;
  /** 1-in-N odds for this exact tier. */
  oneIn: number;
  /** True when `prize` is a historical average or estimate rather than a posted amount. */
  estimated?: boolean;
  isJackpot?: boolean;
}

/**
 * Lottery matrices change. Mega Millions ran 5/70+1/25 until April 2025 and
 * 5/75+1/15 before October 2017; Powerball ran 5/59+1/35 before October 2015.
 * Validating a 2024 draw against today's matrix would reject genuine official
 * data, and pooling numbers across an era boundary silently distorts every
 * frequency statistic. Each era is therefore recorded and applied by draw date.
 */
export interface MatrixEra {
  /** First draw date (inclusive, ISO) on which this matrix applied. */
  from: string;
  max: number;
  extraMax?: number;
  note: string;
}

export interface GameDefinition {
  id: GameId;
  name: string;
  shortName: string;
  payoutModel: PayoutModel;

  /** Positional digit game (Pick N) vs. combinatorial draw (choose K distinct from pool). */
  kind: 'digits' | 'combination';

  /** For `digits`: number of positions, each 0-9. For `combination`: how many balls drawn. */
  pick: number;
  /** Inclusive pool bounds for main numbers. For `digits` this is 0..9 per position. */
  min: number;
  max: number;

  extraBall?: ExtraBall;
  /** Named draw slots. Single-draw games use `['main']`. */
  slots: DrawSlot[];
  slotLabels?: Record<string, string>;

  /** Base ticket price used for cost, ROI and EV math. */
  basePrice: number;
  /** 1-in-N odds of winning the top prize. */
  topPrizeOneIn: number;
  /** 1-in-N odds of winning anything, as published. */
  overallOneIn: number;
  prizeTiers: PrizeTier[];

  /** Official source PDF basename on files.floridalottery.com/exptkt/. */
  sourceFile: string;
  /** Drawing cadence, for gap detection. */
  drawsPerWeek: number;
  /**
   * Historical matrices, oldest first. The top-level `max`/`extraBall` fields
   * describe the *current* matrix; these describe earlier ones.
   */
  matrixEras?: MatrixEra[];
  notes?: string;
}

export interface Draw {
  id: number;
  gameId: GameId;
  drawDate: string;      // ISO yyyy-mm-dd
  drawSlot: DrawSlot;
  numbers: number[];
  extras: Record<string, number>;
  source: string;
}

export interface Ticket {
  id: number;
  gameId: GameId;
  numbers: number[];
  extras: Record<string, number>;
  strategy: string;
  score: number | null;
  cost: number;
  drawSlot: DrawSlot;
  createdAt: string;
  targetDrawDate: string | null;
  note?: string | null;
}

export interface TicketResult {
  ticketId: number;
  drawId: number;
  matches: number;
  extraMatch: boolean;
  tier: string | null;
  payout: number;
  checkedAt: string;
}

/**
 * A 0-100 composite. Explicitly NOT a probability of winning and never rendered
 * with a % sign. Components are always exposed so the number is auditable.
 */
export interface StrategyScore {
  total: number;
  components: ScoreComponent[];
  explanation: string;
}

export interface ScoreComponent {
  key: string;
  label: string;
  value: number;   // 0-100 sub-score
  weight: number;  // contribution weight, sums to 1 across components
  detail: string;
}

export interface GeneratedTicket {
  numbers: number[];
  extras: Record<string, number>;
  score: StrategyScore;
}

export interface GenerateOptions {
  gameId: GameId;
  strategy: StrategyId;
  slot: DrawSlot;
  count: number;
  exclude?: number[];
  lock?: number[];
  require?: number[];
  /** Reject tickets matching trivial patterns (arithmetic runs, all-same-decade, etc.). */
  avoidTrivialPatterns?: boolean;
  /** Batch shaping. */
  batchMode?: 'independent' | 'low_overlap' | 'coverage';
  seed?: number;
}

export type StrategyId =
  | 'balanced'
  | 'unpopular'
  | 'random'
  | 'hot'
  | 'cold'
  | 'overdue'
  | 'frequency_weighted'
  | 'contrarian';

export interface StrategyDefinition {
  id: StrategyId;
  name: string;
  description: string;
  /**
   * Honest classification of what the strategy can actually do.
   * - `neutral`      Uniform random. The mathematical baseline.
   * - `ev_positive`  Genuinely improves E[payout | win] in shared-prize games.
   * - `cosmetic`     Changes which numbers you get. Does not change odds or EV.
   */
  class: 'neutral' | 'ev_positive' | 'cosmetic';
  /** Shown inline wherever the strategy is selectable. */
  disclosure: string;
  /** Hidden on fixed-payout games where it would be meaningless. */
  requiresSharedPrizes?: boolean;
}
