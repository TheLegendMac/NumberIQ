/**
 * Prize evaluation — shared by the backtester and the ticket tracker so that a
 * simulated win and a real win are scored by exactly the same code.
 */
import type { Draw, GameDefinition, PrizeTier } from '../index.js';

export interface Evaluation {
  matches: number;
  extraMatch: boolean;
  tier: PrizeTier | null;
  payout: number;
  /** True when the payout is an assumption (pari-mutuel or jackpot), not a posted amount. */
  payoutEstimated: boolean;
}

export interface EvaluateOptions {
  /**
   * Stand-in value for tiers whose prize is null (jackpots, pari-mutuel top tiers).
   * Backtests default this to 0 so that ROI is never inflated by an imagined jackpot;
   * callers that want a jackpot-inclusive view must opt in explicitly.
   */
  jackpotValue?: number;
}

/** Count matches between a ticket and a draw, respecting digit-game positional rules. */
export function countMatches(game: GameDefinition, ticket: number[], draw: number[]): number {
  if (game.kind === 'digits') {
    // Straight play: every position must match, in order.
    let exact = 0;
    for (let i = 0; i < ticket.length; i++) if (ticket[i] === draw[i]) exact++;
    return exact;
  }
  const drawn = new Set(draw);
  return ticket.filter((n) => drawn.has(n)).length;
}

export function evaluateTicket(
  game: GameDefinition,
  ticket: { numbers: number[]; extras?: Record<string, number> },
  draw: Draw,
  opts: EvaluateOptions = {},
): Evaluation {
  const matches = countMatches(game, ticket.numbers, draw.numbers);

  let extraMatch = false;
  if (game.extraBall) {
    const t = ticket.extras?.[game.extraBall.key];
    const d = draw.extras?.[game.extraBall.key];
    extraMatch = t !== undefined && d !== undefined && t === d;
  }

  // Digit games only pay on a full straight match.
  if (game.kind === 'digits') {
    const won = matches === game.pick;
    const tier = won ? (game.prizeTiers[0] ?? null) : null;
    return {
      matches, extraMatch: false, tier,
      payout: tier?.prize ?? 0,
      payoutEstimated: false,
    };
  }

  // Highest-value matching tier wins. Tiers requiring the extra ball only apply
  // when it actually matched.
  let best: PrizeTier | null = null;
  for (const t of game.prizeTiers) {
    if (t.match !== matches) continue;
    if (t.extra === true && !extraMatch) continue;
    if (t.extra === false && extraMatch) continue;
    if (!best || (t.prize ?? Infinity) > (best.prize ?? Infinity)) best = t;
  }
  if (!best) return { matches, extraMatch, tier: null, payout: 0, payoutEstimated: false };

  const estimated = best.prize === null;
  const payout = best.prize ?? opts.jackpotValue ?? 0;
  return { matches, extraMatch, tier: best, payout, payoutEstimated: estimated || !!best.estimated };
}
