/**
 * Backtest worker.
 *
 * A backtest runs hundreds of Monte Carlo replications over hundreds of
 * drawings. On the main thread that measured a 1.4s frozen UI at default
 * settings, scaling linearly — 5,000 drawings would lock the page for ~14s.
 * Running it here keeps the interface responsive and lets us report real
 * progress instead of a spinner that lies.
 */
import { runBacktest, type BacktestResult, type Draw, type GameDefinition, type StrategyId } from '@numberiq/shared';

export interface BacktestRequest {
  type: 'run';
  game: GameDefinition;
  slot: string;
  strategies: StrategyId[];
  ticketsPerDraw: number;
  maxDraws: number;
  minHistory: number;
  nullReplications: number;
  seed: number;
  draws: Draw[];
}

export type BacktestProgress =
  | { type: 'progress'; phase: 'baseline' | 'strategies'; completed: number; total: number; label: string }
  | { type: 'done'; result: BacktestResult }
  | { type: 'error'; message: string };

self.onmessage = (event: MessageEvent<BacktestRequest>) => {
  const req = event.data;
  if (req.type !== 'run') return;

  const post = (msg: BacktestProgress) => self.postMessage(msg);

  try {
    post({
      type: 'progress', phase: 'baseline', completed: 0, total: req.nullReplications,
      label: 'Simulating random play…',
    });

    const result = runBacktest(
      {
        game: req.game,
        slot: req.slot,
        strategies: req.strategies,
        ticketsPerDraw: req.ticketsPerDraw,
        maxDraws: req.maxDraws,
        minHistory: req.minHistory,
        nullReplications: req.nullReplications,
        seed: req.seed,
        onProgress: (phase, completed, total) => {
          post({
            type: 'progress', phase, completed, total,
            label: phase === 'baseline'
              ? `Simulating random play — ${completed} of ${total} runs`
              : `Testing strategies — ${completed} of ${total}`,
          });
        },
      },
      req.draws,
    );

    post({ type: 'done', result });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
