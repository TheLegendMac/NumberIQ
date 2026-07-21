import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import {
  GAME_LIST, getGame, isGameId, strategiesForGame, STRATEGIES,
  expectedValuePerTicket, evLowerBound, matrixForDate,
  generateRequestSchema, backtestRequestSchema, saveTicketSchema, settingsSchema,
  type GameId, type StrategyId,
} from '@numberiq/shared';
import { getDb } from '../db/index.js';
import { DrawRepository, TicketRepository, SettingsRepository, IngestRunRepository } from '../db/repositories.js';
import { syncGame, ingestDraws, analyzeGaps } from '../ingest/pipeline.js';
import { parseSpreadsheet } from '../ingest/spreadsheet.js';
import { computeStats, rollingFrequency } from '@numberiq/shared';
import { runRandomnessAudit } from '@numberiq/shared';
import { estimatePopularity } from '@numberiq/shared';
import { generateTickets } from '@numberiq/shared';
import { runBacktest } from '@numberiq/shared';
import { checkPendingTickets, summarize, budgetStatus, budgetPlan } from '../analysis/tracker.js';

export const api = Router();

/** Wraps async handlers so rejections reach the error middleware. */
const h =
  (fn: (req: Request, res: Response) => Promise<void> | void) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };

function requireGame(req: Request): GameId {
  const id = req.params.gameId ?? (req.query.gameId as string);
  if (!isGameId(id)) throw Object.assign(new Error(`Unknown game "${id}"`), { status: 400 });
  return id;
}

function resolveSlot(gameId: GameId, requested: unknown): string {
  const game = getGame(gameId);
  const s = typeof requested === 'string' ? requested : '';
  return game.slots.includes(s) ? s : game.slots[game.slots.length - 1]!;
}

// --- Games & odds ----------------------------------------------------------

api.get('/games', (_req, res) => {
  const db = getDb();
  const drawRepo = new DrawRepository(db);
  const runRepo = new IngestRunRepository(db);

  res.json(
    GAME_LIST.map((g) => ({
      ...g,
      strategies: strategiesForGame(g).map((s) => s.id),
      expectedValue: expectedValuePerTicket(g),
      expectedValueLowerBound: evLowerBound(g),
      data: drawRepo.summary(g.id),
      lastSync: runRepo.latestFor(g.id),
    })),
  );
});

api.get('/games/:gameId/odds', (req, res) => {
  const gameId = requireGame(req);
  const g = getGame(gameId);
  const ev = expectedValuePerTicket(g);
  res.json({
    game: g,
    officialOdds: {
      topPrize: g.topPrizeOneIn,
      overall: g.overallOneIn,
      tiers: g.prizeTiers,
    },
    expectedValue: ev,
    expectedValueLowerBound: evLowerBound(g),
    returnRate: ev === null ? null : ev / g.basePrice,
    disclosure:
      g.payoutModel === 'fixed'
        ? `${g.name} pays fixed, posted amounts. Every combination has identical odds and an identical prize, so no selection method can change expected value.`
        : `${g.name} splits prizes among winners in a tier. Selection cannot change your odds of winning, but avoiding widely-picked combinations increases what you would collect if you win.`,
  });
});

api.get('/strategies', (req, res) => {
  const id = req.query.gameId;
  if (typeof id === 'string' && isGameId(id)) {
    res.json(strategiesForGame(getGame(id)));
    return;
  }
  res.json(STRATEGIES);
});

// --- Data / ingest ---------------------------------------------------------

api.get('/data/:gameId', (req, res) => {
  const gameId = requireGame(req);
  const db = getDb();
  res.json({
    summary: new DrawRepository(db).summary(gameId),
    gaps: analyzeGaps(db, gameId),
    lastSync: new IngestRunRepository(db).latestFor(gameId),
  });
});

api.post('/data/:gameId/sync', h(async (req, res) => {
  const gameId = requireGame(req);
  const force = req.body?.force === true;
  const report = await syncGame(getDb(), gameId, force ? { maxCacheAgeMs: 0 } : {});
  res.json(report);
}));

api.post('/data/:gameId/import', h(async (req, res) => {
  const gameId = requireGame(req);
  const schema = z.object({ filename: z.string().default('import'), contentBase64: z.string().min(1) });
  const { filename, contentBase64 } = schema.parse(req.body);

  const buffer = Buffer.from(contentBase64, 'base64');
  if (buffer.length === 0) throw Object.assign(new Error('Empty file'), { status: 400 });
  if (buffer.length > 50 * 1024 * 1024) {
    throw Object.assign(new Error('File exceeds the 50 MB limit'), { status: 413 });
  }

  const parsed = parseSpreadsheet(buffer, gameId, filename);
  if (parsed.draws.length === 0) {
    res.status(422).json({ error: 'No draws could be read from this file.', issues: parsed.issues, mapping: parsed.mapping });
    return;
  }
  const report = ingestDraws(getDb(), gameId, parsed.draws, `import:${filename}`);
  res.json({ ...report, mapping: parsed.mapping, issues: [...parsed.issues.slice(0, 20), ...report.issues] });
}));

api.get('/draws/:gameId', (req, res) => {
  const gameId = requireGame(req);
  const slot = resolveSlot(gameId, req.query.slot);
  const limit = Math.min(Number(req.query.limit ?? 100), 2000);
  res.json({ slot, draws: new DrawRepository(getDb()).list(gameId, slot, limit) });
});

// --- Analysis --------------------------------------------------------------

api.get('/stats/:gameId', (req, res) => {
  const gameId = requireGame(req);
  const slot = resolveSlot(gameId, req.query.slot);
  const window = req.query.window ? Number(req.query.window) : undefined;
  const draws = new DrawRepository(getDb()).list(gameId, slot);
  res.json(computeStats(getGame(gameId), slot, draws, window));
});

api.get('/stats/:gameId/rolling', (req, res) => {
  const gameId = requireGame(req);
  const slot = resolveSlot(gameId, req.query.slot);
  const windowSize = Math.max(10, Number(req.query.window ?? 100));
  const draws = new DrawRepository(getDb()).list(gameId, slot, 5000);
  res.json(rollingFrequency(getGame(gameId), draws, windowSize, Math.max(1, Math.floor(windowSize / 4))));
});

api.get('/randomness/:gameId', (req, res) => {
  const gameId = requireGame(req);
  const slot = resolveSlot(gameId, req.query.slot);
  const draws = new DrawRepository(getDb()).list(gameId, slot);
  res.json(runRandomnessAudit(getGame(gameId), slot, draws));
});

api.post('/popularity/:gameId', (req, res) => {
  const gameId = requireGame(req);
  const numbers = z.array(z.number().int()).parse(req.body?.numbers);
  const recent = new DrawRepository(getDb()).list(gameId, resolveSlot(gameId, req.body?.slot), 100);
  res.json(estimatePopularity(getGame(gameId), numbers, { recentDraws: recent }));
});

// --- Generation ------------------------------------------------------------

api.post('/generate', (req, res) => {
  const input = generateRequestSchema.parse(req.body);
  const game = getGame(input.gameId);
  const slot = resolveSlot(input.gameId, input.slot);

  // Budget is a hard gate, not a suggestion.
  const budget = budgetStatus(getDb());
  if (budget.exceeded) {
    res.status(403).json({
      error: 'budget_exceeded',
      message: 'You have reached the budget you set. Generation is paused until the next period.',
      budget,
    });
    return;
  }

  const history = new DrawRepository(getDb()).list(input.gameId, slot, 2000)
    .sort((a, b) => a.drawDate.localeCompare(b.drawDate));

  const result = generateTickets({
    game,
    history,
    strategy: input.strategy as StrategyId,
    count: input.count,
    exclude: input.exclude,
    lock: input.lock,
    require: input.require,
    avoidTrivialPatterns: input.avoidTrivialPatterns,
    batchMode: input.batchMode,
    windowSize: input.windowSize,
    seed: input.seed,
  });

  res.json({
    ...result,
    slot,
    costPerTicket: game.basePrice,
    totalCost: game.basePrice * result.tickets.length,
    payoutModel: game.payoutModel,
    disclosure:
      game.payoutModel === 'fixed'
        ? 'This game pays fixed amounts. Every combination has identical odds and an identical prize — these numbers are a convenience, not an advantage.'
        : 'Selection cannot change your odds of winning. In this game it can change how much you would collect if you win.',
  });
});

// --- Backtest --------------------------------------------------------------

api.post('/backtest', (req, res) => {
  const input = backtestRequestSchema.parse(req.body);
  const game = getGame(input.gameId);
  const slot = resolveSlot(input.gameId, input.slot);
  const draws = new DrawRepository(getDb()).listAscending(input.gameId, slot);

  const result = runBacktest(
    {
      game, slot,
      strategies: input.strategies as StrategyId[],
      ticketsPerDraw: input.ticketsPerDraw,
      maxDraws: input.maxDraws,
      minHistory: input.minHistory,
      nullReplications: input.nullReplications,
      seed: input.seed,
    },
    draws,
  );
  res.json(result);
});

// --- Tickets & tracking ----------------------------------------------------

api.get('/tickets', (req, res) => {
  const db = getDb();
  checkPendingTickets(db);
  const gameId = typeof req.query.gameId === 'string' && isGameId(req.query.gameId) ? req.query.gameId : undefined;
  const repo = new TicketRepository(db);
  const results = new Map(repo.results().map((r) => [r.ticketId, r]));
  res.json(
    repo.list(gameId).map((t) => ({ ...t, result: results.get(t.id) ?? null })),
  );
});

api.post('/tickets', (req, res) => {
  const body = z.union([saveTicketSchema, z.array(saveTicketSchema)]).parse(req.body);
  const list = Array.isArray(body) ? body : [body];
  const repo = new TicketRepository(getDb());
  const ids = list.map((t) =>
    repo.insert({
      gameId: t.gameId, numbers: t.numbers, extras: t.extras, strategy: t.strategy,
      score: t.score, cost: t.cost, drawSlot: t.drawSlot,
      targetDrawDate: t.targetDrawDate, note: t.note,
    }),
  );
  checkPendingTickets(getDb());
  res.status(201).json({ ids, saved: ids.length });
});

api.delete('/tickets/:id', (req, res) => {
  const id = Number(req.params.id);
  const ok = new TicketRepository(getDb()).remove(id);
  res.status(ok ? 204 : 404).end();
});

api.get('/tracker', (_req, res) => {
  const db = getDb();
  const checked = checkPendingTickets(db);
  res.json({ ...summarize(db), justChecked: checked });
});

// --- Settings & budget -----------------------------------------------------

api.get('/settings', (_req, res) => {
  res.json({ settings: new SettingsRepository(getDb()).getAll(), budget: budgetStatus(getDb()) });
});

api.put('/settings', (req, res) => {
  const values = settingsSchema.parse(req.body);
  new SettingsRepository(getDb()).setAll(values as Record<string, unknown>);
  res.json({ settings: new SettingsRepository(getDb()).getAll(), budget: budgetStatus(getDb()) });
});

api.get('/budget/plan', (req, res) => {
  const gameId = requireGame(req);
  const status = budgetStatus(getDb());
  const remaining = status.weeklyRemaining ?? status.monthlyRemaining ?? Number(req.query.amount ?? 20);
  res.json({ status, plan: budgetPlan(gameId, Math.max(0, remaining)) });
});
