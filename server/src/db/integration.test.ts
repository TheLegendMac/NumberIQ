import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { getGame, type RawDraw } from '@numberiq/shared';
import { createTestDb } from './index.js';
import { DrawRepository, TicketRepository, SettingsRepository } from './repositories.js';
import { ingestDraws, analyzeGaps } from '../ingest/pipeline.js';
import { parseSpreadsheet } from '../ingest/spreadsheet.js';
import { checkPendingTickets, summarize, budgetStatus, budgetPlan } from '../analysis/tracker.js';
import { computeStats } from '../analysis/stats.js';
import { runRandomnessAudit } from '../analysis/randomness.js';

let db: Database.Database;
beforeEach(() => { db = createTestDb(); });

const f5 = (date: string, numbers: number[], slot = 'evening'): RawDraw => ({
  gameId: 'fantasy5', drawDate: date, drawSlot: slot, numbers, extras: {}, source: 'test',
});

describe('draw persistence', () => {
  it('inserts and reads back draws', () => {
    const report = ingestDraws(db, 'fantasy5', [f5('2024-01-01', [1, 2, 3, 4, 5])], 'test');
    expect(report.added).toBe(1);
    const rows = new DrawRepository(db).list('fantasy5', 'evening');
    expect(rows[0]!.numbers).toEqual([1, 2, 3, 4, 5]);
  });

  it('is idempotent — re-ingesting the same data adds nothing', () => {
    const batch = [f5('2024-01-01', [1, 2, 3, 4, 5]), f5('2024-01-02', [6, 7, 8, 9, 10])];
    expect(ingestDraws(db, 'fantasy5', batch, 't').added).toBe(2);
    const second = ingestDraws(db, 'fantasy5', batch, 't');
    expect(second.added).toBe(0);
    expect(second.duplicates).toBe(2);
    expect(new DrawRepository(db).list('fantasy5', 'evening')).toHaveLength(2);
  });

  it('treats the same date in different slots as distinct draws', () => {
    ingestDraws(db, 'fantasy5', [
      f5('2024-01-01', [1, 2, 3, 4, 5], 'evening'),
      f5('2024-01-01', [6, 7, 8, 9, 10], 'midday'),
    ], 't');
    expect(new DrawRepository(db).list('fantasy5', 'evening')).toHaveLength(1);
    expect(new DrawRepository(db).list('fantasy5', 'midday')).toHaveLength(1);
  });

  it('keeps invalid records out of the database entirely', () => {
    const report = ingestDraws(db, 'fantasy5', [
      f5('2024-01-01', [1, 2, 3, 4, 5]),
      f5('2024-01-02', [1, 2, 3, 4, 99]),
    ], 't');
    expect(report.added).toBe(1);
    expect(report.rejected).toBe(1);
    expect(new DrawRepository(db).list('fantasy5', 'evening')).toHaveLength(1);
  });

  it('listBefore never returns the reference date or later', () => {
    ingestDraws(db, 'fantasy5', [
      f5('2024-01-01', [1, 2, 3, 4, 5]),
      f5('2024-01-02', [6, 7, 8, 9, 10]),
      f5('2024-01-03', [11, 12, 13, 14, 15]),
    ], 't');
    const before = new DrawRepository(db).listBefore('fantasy5', 'evening', '2024-01-02');
    expect(before).toHaveLength(1);
    expect(before[0]!.drawDate).toBe('2024-01-01');
  });
});

describe('gap detection', () => {
  it('reports no gaps for a complete daily run', () => {
    const draws = Array.from({ length: 40 }, (_, i) =>
      f5(new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10), [1, 2, 3, 4, 5]));
    ingestDraws(db, 'fantasy5', draws, 't');
    const evening = analyzeGaps(db, 'fantasy5').find((g) => g.slot === 'evening')!;
    expect(evening.missing).toHaveLength(0);
    expect(evening.outOfOrder).toBe(false);
  });

  it('finds a genuinely missing day', () => {
    const dates = Array.from({ length: 30 }, (_, i) =>
      new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10));
    const withHole = dates.filter((d) => d !== '2026-01-15');
    ingestDraws(db, 'fantasy5', withHole.map((d) => f5(d, [1, 2, 3, 4, 5])), 't');
    const evening = analyzeGaps(db, 'fantasy5').find((g) => g.slot === 'evening')!;
    expect(evening.missing).toContain('2026-01-15');
  });
});

describe('spreadsheet import', () => {
  it('reads a CSV with a delimited numbers column', () => {
    const csv = 'Draw Date,Winning Numbers\n2024-03-01,"3-14-22-29-35"\n2024-03-02,"1-2-3-4-5"\n';
    const parsed = parseSpreadsheet(Buffer.from(csv), 'fantasy5', 'test.csv');
    expect(parsed.draws).toHaveLength(2);
    expect(parsed.draws[0]!.numbers).toEqual([3, 14, 22, 29, 35]);
  });

  it('reads positional columns', () => {
    const csv = 'date,N1,N2,N3,N4,N5\n03/01/2024,3,14,22,29,35\n';
    const parsed = parseSpreadsheet(Buffer.from(csv), 'fantasy5', 'test.csv');
    expect(parsed.draws[0]!.numbers).toEqual([3, 14, 22, 29, 35]);
  });

  it('reads an extra ball column', () => {
    const csv = 'Draw Date,Numbers,Powerball\n2024-03-01,"9 14 44 50 56",3\n';
    const parsed = parseSpreadsheet(Buffer.from(csv), 'powerball', 'pb.csv');
    expect(parsed.draws[0]!.extras.powerball).toBe(3);
  });

  it('maps draw-type text onto slots', () => {
    const csv = 'Draw Date,Draw Type,Numbers\n2024-03-01,Midday,"3-14-22-29-35"\n';
    const parsed = parseSpreadsheet(Buffer.from(csv), 'fantasy5', 'x.csv');
    expect(parsed.draws[0]!.drawSlot).toBe('midday');
  });

  it('explains itself when no date column can be found', () => {
    const parsed = parseSpreadsheet(Buffer.from('a,b\n1,2\n'), 'fantasy5', 'bad.csv');
    expect(parsed.draws).toHaveLength(0);
    expect(parsed.issues[0]).toMatch(/date column/i);
  });

  it('routes imported rows through the same validation as official data', () => {
    const csv = 'Draw Date,Winning Numbers\n2024-03-01,"3-14-22-29-99"\n';
    const parsed = parseSpreadsheet(Buffer.from(csv), 'fantasy5', 'x.csv');
    const report = ingestDraws(db, 'fantasy5', parsed.draws, 'import');
    expect(report.added).toBe(0);
    expect(report.rejected).toBe(1);
  });
});

describe('ticket tracking', () => {
  function seedTicketAndDraw(numbers: number[], drawNumbers: number[]) {
    ingestDraws(db, 'fantasy5', [f5('2026-02-01', drawNumbers)], 't');
    new TicketRepository(db).insert({
      gameId: 'fantasy5', numbers, extras: {}, strategy: 'balanced',
      score: 70, cost: 1, drawSlot: 'evening', targetDrawDate: '2026-02-01', note: null,
    });
  }

  it('checks a ticket against its target draw and records the payout', () => {
    seedTicketAndDraw([1, 2, 3, 4, 20], [1, 2, 3, 4, 5]);
    const { checked } = checkPendingTickets(db);
    expect(checked).toBe(1);
    const summary = summarize(db);
    expect(summary.checkedCount).toBe(1);
    expect(summary.winnings).toBe(106); // 4-of-5 tier
  });

  it('is idempotent — re-checking does not double count', () => {
    seedTicketAndDraw([1, 2, 3, 4, 20], [1, 2, 3, 4, 5]);
    checkPendingTickets(db);
    checkPendingTickets(db);
    checkPendingTickets(db);
    expect(summarize(db).winnings).toBe(106);
  });

  it('leaves a ticket pending when its draw has not been ingested', () => {
    new TicketRepository(db).insert({
      gameId: 'fantasy5', numbers: [1, 2, 3, 4, 5], extras: {}, strategy: 'random',
      score: null, cost: 1, drawSlot: 'evening', targetDrawDate: '2030-01-01', note: null,
    });
    expect(checkPendingTickets(db).checked).toBe(0);
    expect(summarize(db).pendingCount).toBe(1);
  });

  it('computes net position and ROI, and reports losses honestly', () => {
    ingestDraws(db, 'fantasy5', [f5('2026-02-01', [1, 2, 3, 4, 5])], 't');
    const repo = new TicketRepository(db);
    for (let i = 0; i < 10; i++) {
      repo.insert({
        gameId: 'fantasy5', numbers: [10, 11, 12, 13, 14], extras: {}, strategy: 'random',
        score: null, cost: 1, drawSlot: 'evening', targetDrawDate: '2026-02-01', note: null,
      });
    }
    checkPendingTickets(db);
    const s = summarize(db);
    expect(s.spend).toBe(10);
    expect(s.winnings).toBe(0);
    expect(s.net).toBe(-10);
    expect(s.roi).toBe(-1);
  });

  it('breaks results down by strategy', () => {
    ingestDraws(db, 'fantasy5', [f5('2026-02-01', [1, 2, 3, 4, 5])], 't');
    const repo = new TicketRepository(db);
    repo.insert({ gameId: 'fantasy5', numbers: [1, 2, 3, 4, 20], extras: {}, strategy: 'hot', score: null, cost: 1, drawSlot: 'evening', targetDrawDate: '2026-02-01', note: null });
    repo.insert({ gameId: 'fantasy5', numbers: [30, 31, 32, 33, 34], extras: {}, strategy: 'cold', score: null, cost: 1, drawSlot: 'evening', targetDrawDate: '2026-02-01', note: null });
    checkPendingTickets(db);
    const s = summarize(db);
    expect(s.byStrategy.find((x) => x.strategy === 'hot')!.winnings).toBe(106);
    expect(s.byStrategy.find((x) => x.strategy === 'cold')!.winnings).toBe(0);
  });
});

describe('budget', () => {
  it('flags an exceeded weekly budget', () => {
    new SettingsRepository(db).setAll({ weeklyBudget: 5 });
    const repo = new TicketRepository(db);
    for (let i = 0; i < 6; i++) {
      repo.insert({ gameId: 'fantasy5', numbers: [1, 2, 3, 4, 5], extras: {}, strategy: 'random', score: null, cost: 1, drawSlot: 'evening', targetDrawDate: null, note: null });
    }
    const status = budgetStatus(db);
    expect(status.spentThisWeek).toBe(6);
    expect(status.exceeded).toBe(true);
  });

  it('is not exceeded when under the limit', () => {
    new SettingsRepository(db).setAll({ weeklyBudget: 20 });
    expect(budgetStatus(db).exceeded).toBe(false);
  });

  it('states the expected loss plainly for fixed-payout games', () => {
    const plan = budgetPlan('pick3', 20);
    expect(plan.tickets).toBe(20);
    expect(plan.expectedLoss).toBeCloseTo(10, 6); // 50% RTP
    expect(plan.note).toMatch(/expected loss/i);
  });

  it('declines to state an exact expected loss for pari-mutuel games', () => {
    expect(budgetPlan('fantasy5', 20).expectedLoss).toBeNull();
  });
});

describe('statistics', () => {
  it('excludes prior matrix eras so old numbers do not look permanently hot', () => {
    // Fantasy 5 was 5/26 until July 2001.
    const old = Array.from({ length: 50 }, (_, i) =>
      f5(new Date(Date.UTC(2000, 0, 1) + i * 86_400_000).toISOString().slice(0, 10), [1, 2, 3, 4, 5]));
    const modern = Array.from({ length: 50 }, (_, i) =>
      f5(new Date(Date.UTC(2020, 0, 1) + i * 86_400_000).toISOString().slice(0, 10), [10, 20, 30, 32, 34]));
    ingestDraws(db, 'fantasy5', [...old, ...modern], 't');

    const draws = new DrawRepository(db).list('fantasy5', 'evening');
    const stats = computeStats(getGame('fantasy5'), 'evening', draws);

    expect(stats.era.excludedDraws).toBe(50);
    expect(stats.drawCount).toBe(50);
    // Number 1 appeared 50 times in the old era but must not register at all now.
    expect(stats.numbers.find((n) => n.n === 1)!.count).toBe(0);
  });

  it('reports insufficient data rather than testing a tiny sample', () => {
    ingestDraws(db, 'fantasy5', [f5('2026-01-01', [1, 2, 3, 4, 5])], 't');
    const audit = runRandomnessAudit(getGame('fantasy5'), 'evening', new DrawRepository(db).list('fantasy5', 'evening'));
    expect(audit.verdict).toBe('insufficient_data');
  });
});
