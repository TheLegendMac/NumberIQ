import type { GameDefinition, GameId, GeneratedTicket, StrategyDefinition, Ticket, Draw, StrategyId } from '@numberiq/shared';
import {
  getGame, computeStats, runRandomnessAudit, generateTickets, runBacktest, estimatePopularity,
} from '@numberiq/shared';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let payload: unknown = null;
    try {
      payload = await res.json();
      const p = payload as { message?: string; error?: string };
      message = p.message ?? p.error ?? message;
    } catch { /* non-JSON error body */ }
    throw Object.assign(new Error(message), { status: res.status, payload });
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) });

// --- Types returned by the API ---------------------------------------------

export interface GameSummary extends GameDefinition {
  strategies: string[];
  expectedValue: number | null;
  expectedValueLowerBound: number;
  data: Array<{ slot: string; count: number; first: string; last: string }>;
  lastSync: { ran_at: string; added: number; source: string } | null;
}

export interface GenerateResponse {
  tickets: GeneratedTicket[];
  batch: { averageOverlap: number; distinctNumbers: number; poolCoverage: number };
  warnings: string[];
  slot: string;
  costPerTicket: number;
  totalCost: number;
  payoutModel: string;
  disclosure: string;
}

export interface OddsResponse {
  game: GameDefinition;
  officialOdds: { topPrize: number; overall: number; tiers: GameDefinition['prizeTiers'] };
  expectedValue: number | null;
  expectedValueLowerBound: number;
  returnRate: number | null;
  disclosure: string;
}

export interface StatsResponse {
  gameId: string; slot: string; drawCount: number; first: string | null; last: string | null;
  poolMin: number; poolMax: number;
  numbers: Array<{ n: number; count: number; expected: number; z: number; lastSeen: string | null; currentGap: number; averageGap: number | null; maxGap: number | null }>;
  hot: StatsResponse['numbers']; cold: StatsResponse['numbers']; overdue: StatsResponse['numbers'];
  sums: { min: number; max: number; mean: number; stdev: number; histogram: Array<{ label: string; value: number; count: number }> };
  oddEven: Array<{ label: string; value: number; count: number }>;
  highLow: Array<{ label: string; value: number; count: number }>;
  consecutive: Array<{ label: string; value: number; count: number }>;
  repeatsFromPrevious: Array<{ label: string; value: number; count: number }>;
  positions: Array<{ position: number; counts: Array<{ label: string; value: number; count: number }> }>;
  topPairs: Array<{ a: number; b: number; count: number; expected: number }>;
  note: string;
  era: { note: string; excludedDraws: number };
}

export interface RandomnessResponse {
  gameId: string; slot: string; drawCount: number; eraNote: string;
  tests: Array<{ name: string; statistic: number; df?: number; pValue: number; significant: boolean; interpretation: string; detail: string }>;
  verdict: 'consistent_with_random' | 'anomaly_detected' | 'insufficient_data';
  summary: string;
}

export interface BacktestResponse {
  gameId: string; slot: string; drawsTested: number;
  window: { from: string; to: string };
  ticketsPerDraw: number; costPerTicket: number;
  nullDistribution: { replications: number; meanRoi: number; stdevRoi: number; p05: number; p95: number };
  strategies: Array<{
    strategy: string; drawsTested: number; ticketsPlayed: number; spend: number; winnings: number;
    net: number; roi: number; returnPct: number; winCount: number; winRate: number; jackpotHits: number;
    tierCounts: Record<string, number>; longestLosingStreak: number;
    percentileVsRandom: number; pValue: number;
    verdict: 'not_distinguishable' | 'better_than_random' | 'worse_than_random';
    equityCurve: Array<{ index: number; date: string; net: number }>;
  }>;
  caveats: string[];
  summary: string;
}

export interface TrackerResponse {
  ticketCount: number; checkedCount: number; pendingCount: number;
  spend: number; winnings: number; net: number; roi: number;
  byStrategy: Array<{ strategy: string; tickets: number; spend: number; winnings: number; net: number; roi: number; wins: number }>;
  byGame: Array<{ gameId: string; tickets: number; spend: number; winnings: number; net: number }>;
  biggestWin: { amount: number; tier: string | null; date: string } | null;
}

export interface BudgetStatus {
  weeklyBudget: number | null; monthlyBudget: number | null;
  spentThisWeek: number; spentThisMonth: number;
  weeklyRemaining: number | null; monthlyRemaining: number | null;
  exceeded: boolean; advice: string[];
}

export interface DataResponse {
  summary: Array<{ slot: string; count: number; first: string; last: string }>;
  gaps: Array<{ slot: string; count: number; first: string | null; last: string | null; missing: string[]; outOfOrder: boolean; expectedPerWeek: number; scanWindow: { from: string; to: string; note: string } | null }>;
  lastSync: { ran_at: string; added: number; source: string } | null;
}

export interface IngestReport {
  gameId: string; source: string; parsed: number; added: number;
  duplicates: number; rejected: number; issues: string[]; slots: Record<string, number>;
}

/**
 * Drawing history cache.
 *
 * Analysis runs in the browser, not on the server — see worker/src/index.ts for
 * why. Each game/slot's drawings are fetched once and reused for statistics, the
 * randomness audit, generation and backtesting, so a backtest re-run costs one
 * `useMemo`, not a network round trip.
 */
const drawCache = new Map<string, Promise<Draw[]>>();

export function fetchDraws(gameId: GameId, slot: string): Promise<Draw[]> {
  const key = `${gameId}:${slot}`;
  let entry = drawCache.get(key);
  if (!entry) {
    entry = request<{ slot: string; draws: Draw[] }>(`/draws/${gameId}?slot=${slot}&limit=20000`)
      .then((r) => r.draws)
      .catch((err) => { drawCache.delete(key); throw err; });
    drawCache.set(key, entry);
  }
  return entry;
}

/** Called after an ingest so the next analysis reflects new drawings. */
export function invalidateDraws(): void {
  drawCache.clear();
}

export const api = {
  games: () => request<GameSummary[]>('/games'),
  odds: (id: GameId) => request<OddsResponse>(`/games/${id}/odds`),
  strategies: (id: GameId) => request<StrategyDefinition[]>(`/strategies?gameId=${id}`),

  data: (id: GameId) => request<DataResponse>(`/data/${id}`),
  sync: (id: GameId, force = false) => post<IngestReport>(`/data/${id}/sync`, { force }),
  importFile: (id: GameId, filename: string, contentBase64: string) =>
    post<IngestReport & { mapping: Record<string, string> }>(`/data/${id}/import`, { filename, contentBase64 }),

  stats: async (id: GameId, slot: string, window?: number): Promise<StatsResponse> =>
    computeStats(getGame(id), slot, await fetchDraws(id, slot), window) as unknown as StatsResponse,

  randomness: async (id: GameId, slot: string): Promise<RandomnessResponse> =>
    runRandomnessAudit(getGame(id), slot, await fetchDraws(id, slot)) as unknown as RandomnessResponse,

  generate: async (body: Record<string, unknown>): Promise<GenerateResponse> => {
    const gameId = body.gameId as GameId;
    const game = getGame(gameId);
    const slot = (body.slot as string) ?? game.slots[game.slots.length - 1]!;

    // The budget ceiling is a hard gate and must be enforced against server state,
    // not client state, so it cannot be bypassed by editing local values.
    const { budget } = await api.settings();
    if (budget.exceeded) {
      throw Object.assign(new Error('You have reached the budget you set. Generation is paused until the next period.'), { status: 403 });
    }

    const history = [...(await fetchDraws(gameId, slot))].sort((a, b) => a.drawDate.localeCompare(b.drawDate));
    const result = generateTickets({
      game,
      history,
      strategy: (body.strategy as StrategyId) ?? 'balanced',
      count: (body.count as number) ?? 5,
      exclude: body.exclude as number[] | undefined,
      lock: body.lock as number[] | undefined,
      require: body.require as number[] | undefined,
      avoidTrivialPatterns: body.avoidTrivialPatterns !== false,
      batchMode: (body.batchMode as 'independent' | 'low_overlap' | 'coverage') ?? 'low_overlap',
      windowSize: body.windowSize as number | undefined,
      seed: body.seed as number | undefined,
    });

    return {
      ...result,
      slot,
      costPerTicket: game.basePrice,
      totalCost: game.basePrice * result.tickets.length,
      payoutModel: game.payoutModel,
      disclosure:
        game.payoutModel === 'fixed'
          ? 'This game pays fixed amounts. Every combination has identical odds and an identical prize — these numbers are a convenience, not an advantage.'
          : 'Selection cannot change your odds of winning. In this game it can change how much you would collect if you win.',
    };
  },

  backtest: async (body: Record<string, unknown>): Promise<BacktestResponse> => {
    const gameId = body.gameId as GameId;
    const game = getGame(gameId);
    const slot = (body.slot as string) ?? game.slots[game.slots.length - 1]!;
    const draws = [...(await fetchDraws(gameId, slot))].sort((a, b) => a.drawDate.localeCompare(b.drawDate));

    return runBacktest({
      game, slot,
      strategies: body.strategies as StrategyId[],
      ticketsPerDraw: (body.ticketsPerDraw as number) ?? 1,
      maxDraws: (body.maxDraws as number) ?? 1000,
      minHistory: (body.minHistory as number) ?? 200,
      nullReplications: (body.nullReplications as number) ?? 300,
      seed: (body.seed as number) ?? 12345,
    }, draws) as unknown as BacktestResponse;
  },

  popularity: async (id: GameId, slot: string, numbers: number[]) =>
    estimatePopularity(getGame(id), numbers, { recentDraws: (await fetchDraws(id, slot)).slice(0, 100) }),

  tickets: () => request<Array<Ticket & { result: { payout: number; matches: number; tier: string | null } | null }>>('/tickets'),
  saveTickets: (tickets: unknown[]) => post<{ ids: number[]; saved: number }>('/tickets', tickets),
  deleteTicket: (id: number) => request<void>(`/tickets/${id}`, { method: 'DELETE' }),
  tracker: () => request<TrackerResponse>('/tracker'),

  settings: () => request<{ settings: Record<string, unknown>; budget: BudgetStatus }>('/settings'),
  saveSettings: (body: Record<string, unknown>) =>
    request<{ settings: Record<string, unknown>; budget: BudgetStatus }>('/settings', {
      method: 'PUT', body: JSON.stringify(body),
    }),
};

// --- Formatting helpers ----------------------------------------------------

export const money = (n: number) =>
  `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const pct = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`;

export const oneIn = (n: number) =>
  n >= 1000 ? `1 in ${Math.round(n).toLocaleString()}` : `1 in ${n.toFixed(n < 100 ? 2 : 0)}`;

export const dateLabel = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export const slotLabel = (game: GameDefinition | undefined, slot: string) =>
  game?.slotLabels?.[slot] ?? slot.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
