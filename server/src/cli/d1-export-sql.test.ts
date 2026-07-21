import { describe, expect, it } from 'vitest';
import { createTestDb } from '../db/index.js';
import { renderD1SeedSql, type D1DrawRow } from './d1-export-sql.js';

describe('D1 draw export SQL', () => {
  it('updates corrections without rewriting unchanged rows', () => {
    const db = createTestDb();
    const original: D1DrawRow = {
      game_id: 'powerball',
      draw_date: '2026-07-20',
      draw_slot: 'main',
      numbers: '[2,9,44,53,59]',
      extras: '{"powerball":8}',
      source: 'official:v1',
    };

    db.exec(renderD1SeedSql([original], 1));
    db.prepare(`UPDATE draws SET ingested_at = '2000-01-01 00:00:00'`).run();
    db.exec(renderD1SeedSql([original], 1));
    expect((db.prepare(`SELECT ingested_at FROM draws`).get() as { ingested_at: string }).ingested_at)
      .toBe('2000-01-01 00:00:00');

    db.exec(renderD1SeedSql([{
      ...original,
      numbers: '[1,9,44,53,59]',
      extras: '{"powerball":7}',
      source: 'official:v2',
    }], 1));

    const stored = db.prepare(`SELECT numbers, extras, source, ingested_at FROM draws`).get() as {
      numbers: string; extras: string; source: string; ingested_at: string;
    };
    expect(stored).toMatchObject({
      numbers: '[1,9,44,53,59]',
      extras: '{"powerball":7}',
      source: 'official:v2',
    });
    expect(stored.ingested_at).not.toBe('2000-01-01 00:00:00');
  });
});
