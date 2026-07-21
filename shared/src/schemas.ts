import { z } from 'zod';
import { GAMES, matrixForDate, strategiesForGame } from './games.js';
import type { GameDefinition } from './types.js';

export const gameIdSchema = z.enum(
  Object.keys(GAMES) as [keyof typeof GAMES, ...(keyof typeof GAMES)[]],
);

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected yyyy-mm-dd')
  .refine((s) => !Number.isNaN(Date.parse(s + 'T00:00:00Z')), 'Not a real calendar date');

/**
 * A raw draw as produced by any ingest source (PDF, CSV, Excel) before it is
 * validated against a specific game's matrix.
 */
export const rawDrawSchema = z.object({
  gameId: gameIdSchema,
  drawDate: isoDateSchema,
  drawSlot: z.string().min(1),
  numbers: z.array(z.number().int()).min(1),
  extras: z.record(z.string(), z.number().int()).default({}),
  source: z.string().min(1),
});

export type RawDraw = z.infer<typeof rawDrawSchema>;

export interface ValidationIssue {
  code:
    | 'out_of_range'
    | 'wrong_count'
    | 'duplicate_numbers'
    | 'unknown_slot'
    | 'missing_extra'
    | 'extra_out_of_range'
    | 'future_date'
    | 'implausible_date'
    | 'bad_shape';
  message: string;
}

/**
 * Validate a raw draw against its game's actual matrix. This is the single
 * gate every ingest path passes through — PDF, CSV and Excel all land here, so
 * a malformed record cannot enter the database by any route.
 */
export function validateDraw(game: GameDefinition, draw: RawDraw, today = new Date()): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Validate against the matrix in effect on the draw date, not today's matrix.
  const matrix = matrixForDate(game, draw.drawDate);

  if (draw.numbers.length !== game.pick) {
    issues.push({
      code: 'wrong_count',
      message: `Expected ${game.pick} numbers, got ${draw.numbers.length}`,
    });
  }

  for (const n of draw.numbers) {
    if (!Number.isInteger(n) || n < matrix.min || n > matrix.max) {
      issues.push({
        code: 'out_of_range',
        message: `Number ${n} outside ${matrix.min}-${matrix.max} (${matrix.era})`,
      });
    }
  }

  // Digit games allow repeats (Pick 3 can draw 5-5-5); combination games cannot.
  if (game.kind === 'combination') {
    const uniq = new Set(draw.numbers);
    if (uniq.size !== draw.numbers.length) {
      issues.push({ code: 'duplicate_numbers', message: `Repeated number in ${draw.numbers.join('-')}` });
    }
  }

  if (!game.slots.includes(draw.drawSlot)) {
    issues.push({ code: 'unknown_slot', message: `Unknown draw slot "${draw.drawSlot}"` });
  }

  if (game.extraBall) {
    const v = draw.extras[game.extraBall.key];
    const lo = matrix.extraMin ?? game.extraBall.min;
    const hi = matrix.extraMax ?? game.extraBall.max;
    if (v === undefined) {
      issues.push({ code: 'missing_extra', message: `Missing ${game.extraBall.label}` });
    } else if (v < lo || v > hi) {
      issues.push({
        code: 'extra_out_of_range',
        message: `${game.extraBall.label} ${v} outside ${lo}-${hi} (${matrix.era})`,
      });
    }
  }

  const t = Date.parse(draw.drawDate + 'T00:00:00Z');
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (t > todayUtc) {
    issues.push({ code: 'future_date', message: `Draw date ${draw.drawDate} is in the future` });
  }
  // The Florida Lottery's first draw was in 1988; anything earlier is a parse error.
  if (t < Date.UTC(1988, 0, 1)) {
    issues.push({ code: 'implausible_date', message: `Draw date ${draw.drawDate} predates the Florida Lottery` });
  }

  return issues;
}

// --- API request schemas ---------------------------------------------------

export const generateRequestSchema = z.object({
  gameId: gameIdSchema,
  strategy: z.enum([
    'balanced', 'unpopular', 'random', 'hot', 'cold',
    'overdue', 'frequency_weighted', 'contrarian',
  ]),
  slot: z.string().default('main'),
  count: z.number().int().min(1).max(100).default(5),
  exclude: z.array(z.number().int()).optional(),
  lock: z.array(z.number().int()).optional(),
  require: z.array(z.number().int()).optional(),
  avoidTrivialPatterns: z.boolean().default(true),
  batchMode: z.enum(['independent', 'low_overlap', 'coverage']).default('low_overlap'),
  windowSize: z.number().int().min(10).max(5000).optional(),
  seed: z.number().int().optional(),
});

export const backtestRequestSchema = z.object({
  gameId: gameIdSchema,
  slot: z.string().default('main'),
  strategies: z.array(z.string()).min(1),
  ticketsPerDraw: z.number().int().min(1).max(20).default(1),
  maxDraws: z.number().int().min(20).max(20000).default(1000),
  minHistory: z.number().int().min(20).max(2000).default(200),
  nullReplications: z.number().int().min(50).max(5000).default(500),
  seed: z.number().int().default(12345),
});

export const saveTicketSchema = z.object({
  gameId: gameIdSchema,
  numbers: z.array(z.number().int()),
  extras: z.record(z.string(), z.number().int()).default({}),
  strategy: z.string(),
  score: z.number().min(0).max(100).nullable().default(null),
  cost: z.number().nonnegative(),
  drawSlot: z.string().default('main'),
  targetDrawDate: isoDateSchema.nullable().default(null),
  note: z.string().max(500).nullable().default(null),
}).superRefine((ticket, ctx) => {
  const game = GAMES[ticket.gameId];
  const today = new Date().toISOString().slice(0, 10);
  const matrix = matrixForDate(game, ticket.targetDrawDate ?? today);

  if (ticket.numbers.length !== game.pick) {
    ctx.addIssue({
      code: 'custom', path: ['numbers'],
      message: `Expected exactly ${game.pick} numbers for ${game.name}`,
    });
  }
  for (let i = 0; i < ticket.numbers.length; i++) {
    const n = ticket.numbers[i]!;
    if (n < matrix.min || n > matrix.max) {
      ctx.addIssue({
        code: 'custom', path: ['numbers', i],
        message: `Number must be between ${matrix.min} and ${matrix.max}`,
      });
    }
  }
  if (game.kind === 'combination' && new Set(ticket.numbers).size !== ticket.numbers.length) {
    ctx.addIssue({ code: 'custom', path: ['numbers'], message: 'Combination tickets cannot repeat numbers' });
  }
  if (!game.slots.includes(ticket.drawSlot)) {
    ctx.addIssue({ code: 'custom', path: ['drawSlot'], message: `Unknown drawing for ${game.name}` });
  }
  if (!strategiesForGame(game).some((strategy) => strategy.id === ticket.strategy)) {
    ctx.addIssue({ code: 'custom', path: ['strategy'], message: `Strategy is not available for ${game.name}` });
  }
  if (ticket.cost !== game.basePrice) {
    ctx.addIssue({
      code: 'custom', path: ['cost'],
      message: `Base ticket cost for ${game.name} is ${game.basePrice}`,
    });
  }

  if (game.extraBall) {
    const extra = ticket.extras[game.extraBall.key];
    const min = matrix.extraMin ?? game.extraBall.min;
    const max = matrix.extraMax ?? game.extraBall.max;
    if (extra === undefined || extra < min || extra > max) {
      ctx.addIssue({
        code: 'custom', path: ['extras', game.extraBall.key],
        message: `${game.extraBall.label} must be between ${min} and ${max}`,
      });
    }
  }
});

export const settingsSchema = z.object({
  weeklyBudget: z.number().nonnegative().nullable().optional(),
  monthlyBudget: z.number().nonnegative().nullable().optional(),
  costPerDraw: z.number().nonnegative().nullable().optional(),
});
