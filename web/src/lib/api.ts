import type { GameDefinition, GameId, GeneratedTicket, StrategyDefinition, Ticket } from '@numberiq/shared';

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

export const api = {
  games: () => request<GameSummary[]>('/games'),
  odds: (id: GameId) => request<OddsResponse>(`/games/${id}/odds`),
  strategies: (id: GameId) => request<StrategyDefinition[]>(`/strategies?gameId=${id}`),

  data: (id: GameId) => request<DataResponse>(`/data/${id}`),
  sync: (id: GameId, force = false) => post<IngestReport>(`/data/${id}/sync`, { force }),
  importFile: (id: GameId, filename: string, contentBase64: string) =>
    post<IngestReport & { mapping: Record<string, string> }>(`/data/${id}/import`, { filename, contentBase64 }),

  stats: (id: GameId, slot: string, window?: number) =>
    request<StatsResponse>(`/stats/${id}?slot=${slot}${window ? `&window=${window}` : ''}`),
  randomness: (id: GameId, slot: string) => request<RandomnessResponse>(`/randomness/${id}?slot=${slot}`),

  generate: (body: Record<string, unknown>) => post<GenerateResponse>('/generate', body),
  backtest: (body: Record<string, unknown>) => post<BacktestResponse>('/backtest', body),

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
