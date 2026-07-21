/**
 * Ticket tracking and budget intelligence.
 *
 * Design rule carried over from the Phase 1 audit: net position is the headline
 * figure, never wins in isolation. Over any real sample this number is negative,
 * and the product's job is to show that plainly rather than to soften it.
 */
import type Database from 'better-sqlite3';
import { getGame, type GameId } from '@numberiq/shared';
import { DrawRepository, TicketRepository, SettingsRepository } from '../db/repositories.js';
import { evaluateTicket } from '@numberiq/shared';

export interface TrackerSummary {
  ticketCount: number;
  checkedCount: number;
  pendingCount: number;
  spend: number;
  winnings: number;
  net: number;
  roi: number;
  byStrategy: Array<{
    strategy: string;
    tickets: number;
    spend: number;
    winnings: number;
    net: number;
    roi: number;
    wins: number;
  }>;
  byGame: Array<{ gameId: string; tickets: number; spend: number; winnings: number; net: number }>;
  biggestWin: { amount: number; tier: string | null; date: string } | null;
}

/**
 * Check every saved ticket whose target draw now exists in the database.
 * Idempotent — re-running produces the same results, never double-counts.
 */
export function checkPendingTickets(db: Database.Database): { checked: number; won: number } {
  const tickets = new TicketRepository(db);
  const draws = new DrawRepository(db);
  let checked = 0;
  let won = 0;

  for (const t of tickets.unchecked()) {
    if (!t.targetDrawDate) continue;
    const draw = draws.findByDate(t.gameId, t.drawSlot, t.targetDrawDate);
    if (!draw) continue; // draw hasn't happened or hasn't been ingested yet

    const game = getGame(t.gameId);
    const ev = evaluateTicket(game, t, draw);
    tickets.recordResult({
      ticketId: t.id,
      drawId: draw.id,
      matches: ev.matches,
      extraMatch: ev.extraMatch,
      tier: ev.tier?.label ?? null,
      payout: ev.payout,
    });
    checked++;
    if (ev.payout > 0) won++;
  }
  return { checked, won };
}

export function summarize(db: Database.Database): TrackerSummary {
  const ticketRepo = new TicketRepository(db);
  const all = ticketRepo.list();
  const results = ticketRepo.results();
  const byTicket = new Map(results.map((r) => [r.ticketId, r]));

  let spend = 0;
  let winnings = 0;
  const strategyMap = new Map<string, { tickets: number; spend: number; winnings: number; wins: number }>();
  const gameMap = new Map<string, { tickets: number; spend: number; winnings: number }>();
  let biggest: TrackerSummary['biggestWin'] = null;

  for (const t of all) {
    const r = byTicket.get(t.id);
    const payout = r?.payout ?? 0;
    spend += t.cost;
    winnings += payout;

    const s = strategyMap.get(t.strategy) ?? { tickets: 0, spend: 0, winnings: 0, wins: 0 };
    s.tickets++;
    s.spend += t.cost;
    s.winnings += payout;
    if (payout > 0) s.wins++;
    strategyMap.set(t.strategy, s);

    const g = gameMap.get(t.gameId) ?? { tickets: 0, spend: 0, winnings: 0 };
    g.tickets++;
    g.spend += t.cost;
    g.winnings += payout;
    gameMap.set(t.gameId, g);

    if (payout > 0 && (!biggest || payout > biggest.amount)) {
      biggest = { amount: payout, tier: r?.tier ?? null, date: t.targetDrawDate ?? t.createdAt };
    }
  }

  return {
    ticketCount: all.length,
    checkedCount: results.length,
    pendingCount: all.length - results.length,
    spend,
    winnings,
    net: winnings - spend,
    roi: spend > 0 ? (winnings - spend) / spend : 0,
    byStrategy: [...strategyMap.entries()]
      .map(([strategy, v]) => ({
        strategy, ...v,
        net: v.winnings - v.spend,
        roi: v.spend > 0 ? (v.winnings - v.spend) / v.spend : 0,
      }))
      .sort((a, b) => b.spend - a.spend),
    byGame: [...gameMap.entries()]
      .map(([gameId, v]) => ({ gameId, ...v, net: v.winnings - v.spend }))
      .sort((a, b) => b.spend - a.spend),
    biggestWin: biggest,
  };
}

// ---------------------------------------------------------------------------
// Budget intelligence
// ---------------------------------------------------------------------------

export interface BudgetStatus {
  weeklyBudget: number | null;
  monthlyBudget: number | null;
  spentThisWeek: number;
  spentThisMonth: number;
  weeklyRemaining: number | null;
  monthlyRemaining: number | null;
  /** True when a limit is reached — the UI blocks generation on this. */
  exceeded: boolean;
  advice: string[];
}

function startOfWeekIso(d = new Date()): string {
  const day = d.getUTCDay();
  const diff = (day + 6) % 7; // Monday-based
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff))
    .toISOString().slice(0, 10);
}

function startOfMonthIso(d = new Date()): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

export function budgetStatus(db: Database.Database, now = new Date()): BudgetStatus {
  const settings = new SettingsRepository(db).getAll();
  const weeklyBudget = (settings.weeklyBudget as number | null) ?? null;
  const monthlyBudget = (settings.monthlyBudget as number | null) ?? null;

  const weekStart = startOfWeekIso(now);
  const monthStart = startOfMonthIso(now);

  const spent = (since: string) =>
    (db.prepare(`SELECT COALESCE(SUM(cost), 0) AS s FROM tickets WHERE date(created_at) >= ?`)
      .get(since) as { s: number }).s;

  const spentThisWeek = spent(weekStart);
  const spentThisMonth = spent(monthStart);

  const weeklyRemaining = weeklyBudget === null ? null : weeklyBudget - spentThisWeek;
  const monthlyRemaining = monthlyBudget === null ? null : monthlyBudget - spentThisMonth;
  const exceeded = (weeklyRemaining !== null && weeklyRemaining <= 0) ||
                   (monthlyRemaining !== null && monthlyRemaining <= 0);

  const advice: string[] = [];
  if (exceeded) {
    advice.push('You have reached the budget you set. Generation is paused until the next period.');
  } else if (weeklyRemaining !== null && weeklyBudget && weeklyRemaining < weeklyBudget * 0.25) {
    advice.push(`Only $${weeklyRemaining.toFixed(2)} left of this week's budget.`);
  }
  if (weeklyBudget === null && monthlyBudget === null) {
    advice.push('No budget set. Setting one is the single most effective way to keep this recreational.');
  }
  return {
    weeklyBudget, monthlyBudget, spentThisWeek, spentThisMonth,
    weeklyRemaining, monthlyRemaining, exceeded, advice,
  };
}

/** How many tickets a remaining budget affords, with the honest EV consequence. */
export function budgetPlan(gameId: GameId, remaining: number): {
  tickets: number;
  cost: number;
  expectedLoss: number | null;
  note: string;
} {
  const game = getGame(gameId);
  const tickets = Math.floor(remaining / game.basePrice);
  const cost = tickets * game.basePrice;

  // Only fixed-payout games have a fully determined EV.
  let expectedLoss: number | null = null;
  if (game.payoutModel === 'fixed') {
    const evPerTicket = game.prizeTiers.reduce((s, t) => s + (t.prize ?? 0) / t.oneIn, 0);
    expectedLoss = cost - tickets * evPerTicket;
  }

  const note =
    expectedLoss !== null
      ? `${tickets} tickets at $${game.basePrice.toFixed(2)}. Expected loss over the long run: about $${expectedLoss.toFixed(2)} of the $${cost.toFixed(2)} spent.`
      : `${tickets} tickets at $${game.basePrice.toFixed(2)}. Expected return cannot be stated precisely because the top tiers are pari-mutuel, but it is below the amount spent.`;

  return { tickets, cost, expectedLoss, note };
}
