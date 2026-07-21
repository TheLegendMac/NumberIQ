import type Database from 'better-sqlite3';
import type { Draw, GameId, Ticket, TicketResult } from '@numberiq/shared';
import type { RawDraw } from '@numberiq/shared';

interface DrawRow {
  id: number;
  game_id: string;
  draw_date: string;
  draw_slot: string;
  numbers: string;
  extras: string;
  source: string;
}

function toDraw(r: DrawRow): Draw {
  return {
    id: r.id,
    gameId: r.game_id as GameId,
    drawDate: r.draw_date,
    drawSlot: r.draw_slot,
    numbers: JSON.parse(r.numbers) as number[],
    extras: JSON.parse(r.extras) as Record<string, number>,
    source: r.source,
  };
}

export class DrawRepository {
  constructor(private db: Database.Database) {}

  /**
   * Insert draws idempotently. The UNIQUE(game_id, draw_date, draw_slot)
   * constraint makes re-ingesting the same source a no-op, so syncing twice
   * can never duplicate or corrupt history.
   */
  insertMany(draws: RawDraw[]): { added: number; duplicates: number } {
    const stmt = this.db.prepare(
      `INSERT INTO draws (game_id, draw_date, draw_slot, numbers, extras, source)
       VALUES (@game_id, @draw_date, @draw_slot, @numbers, @extras, @source)
       ON CONFLICT (game_id, draw_date, draw_slot) DO NOTHING`,
    );
    let added = 0;
    const run = this.db.transaction((rows: RawDraw[]) => {
      for (const d of rows) {
        const info = stmt.run({
          game_id: d.gameId,
          draw_date: d.drawDate,
          draw_slot: d.drawSlot,
          numbers: JSON.stringify(d.numbers),
          extras: JSON.stringify(d.extras ?? {}),
          source: d.source,
        });
        added += info.changes;
      }
    });
    run(draws);
    return { added, duplicates: draws.length - added };
  }

  /** Draws for a game/slot, most recent first. */
  list(gameId: GameId, slot: string, limit?: number): Draw[] {
    const sql =
      `SELECT * FROM draws WHERE game_id = ? AND draw_slot = ? ORDER BY draw_date DESC` +
      (limit ? ` LIMIT ${Math.floor(limit)}` : '');
    return (this.db.prepare(sql).all(gameId, slot) as DrawRow[]).map(toDraw);
  }

  /** Draws in ascending date order — the natural order for backtesting. */
  listAscending(gameId: GameId, slot: string): Draw[] {
    return (
      this.db
        .prepare(`SELECT * FROM draws WHERE game_id = ? AND draw_slot = ? ORDER BY draw_date ASC`)
        .all(gameId, slot) as DrawRow[]
    ).map(toDraw);
  }

  /** Strictly before `isoDate` — the only accessor backtests are allowed to use. */
  listBefore(gameId: GameId, slot: string, isoDate: string, limit?: number): Draw[] {
    const sql =
      `SELECT * FROM draws WHERE game_id = ? AND draw_slot = ? AND draw_date < ?
       ORDER BY draw_date DESC` + (limit ? ` LIMIT ${Math.floor(limit)}` : '');
    return (this.db.prepare(sql).all(gameId, slot, isoDate) as DrawRow[]).map(toDraw);
  }

  summary(gameId: GameId): Array<{ slot: string; count: number; first: string; last: string }> {
    return this.db
      .prepare(
        `SELECT draw_slot AS slot, COUNT(*) AS count,
                MIN(draw_date) AS first, MAX(draw_date) AS last
         FROM draws WHERE game_id = ? GROUP BY draw_slot ORDER BY draw_slot`,
      )
      .all(gameId) as Array<{ slot: string; count: number; first: string; last: string }>;
  }

  totalCount(): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM draws`).get() as { n: number }).n;
  }

  findByDate(gameId: GameId, slot: string, isoDate: string): Draw | null {
    const r = this.db
      .prepare(`SELECT * FROM draws WHERE game_id = ? AND draw_slot = ? AND draw_date = ?`)
      .get(gameId, slot, isoDate) as DrawRow | undefined;
    return r ? toDraw(r) : null;
  }

  /** Distinct dates present, ascending — used for gap detection. */
  dates(gameId: GameId, slot: string): string[] {
    return (
      this.db
        .prepare(
          `SELECT draw_date FROM draws WHERE game_id = ? AND draw_slot = ? ORDER BY draw_date ASC`,
        )
        .all(gameId, slot) as Array<{ draw_date: string }>
    ).map((r) => r.draw_date);
  }
}

interface TicketRow {
  id: number;
  game_id: string;
  numbers: string;
  extras: string;
  strategy: string;
  score: number | null;
  cost: number;
  draw_slot: string;
  target_draw_date: string | null;
  note: string | null;
  created_at: string;
}

function toTicket(r: TicketRow): Ticket {
  return {
    id: r.id,
    gameId: r.game_id as GameId,
    numbers: JSON.parse(r.numbers) as number[],
    extras: JSON.parse(r.extras) as Record<string, number>,
    strategy: r.strategy,
    score: r.score,
    cost: r.cost,
    drawSlot: r.draw_slot,
    targetDrawDate: r.target_draw_date,
    note: r.note,
    createdAt: r.created_at,
  };
}

export class TicketRepository {
  constructor(private db: Database.Database) {}

  insert(t: Omit<Ticket, 'id' | 'createdAt'>): number {
    const info = this.db
      .prepare(
        `INSERT INTO tickets (game_id, numbers, extras, strategy, score, cost, draw_slot, target_draw_date, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        t.gameId,
        JSON.stringify(t.numbers),
        JSON.stringify(t.extras ?? {}),
        t.strategy,
        t.score,
        t.cost,
        t.drawSlot,
        t.targetDrawDate,
        t.note ?? null,
      );
    return Number(info.lastInsertRowid);
  }

  list(gameId?: GameId): Ticket[] {
    const rows = gameId
      ? (this.db
          .prepare(`SELECT * FROM tickets WHERE game_id = ? ORDER BY created_at DESC, id DESC`)
          .all(gameId) as TicketRow[])
      : (this.db
          .prepare(`SELECT * FROM tickets ORDER BY created_at DESC, id DESC`)
          .all() as TicketRow[]);
    return rows.map(toTicket);
  }

  byId(id: number): Ticket | null {
    const r = this.db.prepare(`SELECT * FROM tickets WHERE id = ?`).get(id) as TicketRow | undefined;
    return r ? toTicket(r) : null;
  }

  remove(id: number): boolean {
    return this.db.prepare(`DELETE FROM tickets WHERE id = ?`).run(id).changes > 0;
  }

  /** Tickets whose target draw has happened but that have no recorded result yet. */
  unchecked(): Ticket[] {
    return (
      this.db
        .prepare(
          `SELECT t.* FROM tickets t
           WHERE t.target_draw_date IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM ticket_results r WHERE r.ticket_id = t.id)`,
        )
        .all() as TicketRow[]
    ).map(toTicket);
  }

  recordResult(r: Omit<TicketResult, 'checkedAt'>): void {
    this.db
      .prepare(
        `INSERT INTO ticket_results (ticket_id, draw_id, matches, extra_match, tier, payout)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (ticket_id, draw_id) DO UPDATE SET
           matches = excluded.matches, extra_match = excluded.extra_match,
           tier = excluded.tier, payout = excluded.payout, checked_at = datetime('now')`,
      )
      .run(r.ticketId, r.drawId, r.matches, r.extraMatch ? 1 : 0, r.tier, r.payout);
  }

  /**
   * SQLite stores booleans as integers, so the row shape and the domain shape
   * differ on `extraMatch`. They are kept as separate types rather than an
   * intersection, which would be contradictory.
   */
  results(): Array<TicketResult & { gameId: GameId; strategy: string; cost: number }> {
    interface ResultRow {
      ticketId: number; drawId: number; matches: number; extraMatch: number;
      tier: string | null; payout: number; checkedAt: string;
      gameId: GameId; strategy: string; cost: number;
    }
    const rows = this.db
      .prepare(
        `SELECT r.ticket_id AS ticketId, r.draw_id AS drawId, r.matches, r.extra_match AS extraMatch,
                r.tier, r.payout, r.checked_at AS checkedAt,
                t.game_id AS gameId, t.strategy, t.cost
         FROM ticket_results r JOIN tickets t ON t.id = r.ticket_id`,
      )
      .all() as ResultRow[];

    return rows.map((r) => ({ ...r, extraMatch: Boolean(r.extraMatch) }));
  }
}

export class SettingsRepository {
  constructor(private db: Database.Database) {}

  getAll(): Record<string, unknown> {
    const rows = this.db.prepare(`SELECT key, value FROM settings`).all() as Array<{
      key: string;
      value: string;
    }>;
    const out: Record<string, unknown> = {};
    for (const r of rows) {
      try {
        out[r.key] = JSON.parse(r.value);
      } catch {
        out[r.key] = r.value;
      }
    }
    return out;
  }

  setAll(values: Record<string, unknown>): void {
    const stmt = this.db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    );
    const run = this.db.transaction((v: Record<string, unknown>) => {
      for (const [k, val] of Object.entries(v)) stmt.run(k, JSON.stringify(val));
    });
    run(values);
  }
}

export class IngestRunRepository {
  constructor(private db: Database.Database) {}

  record(gameId: GameId, source: string, added: number, duplicates: number, rejected: number, log: unknown[]): void {
    this.db
      .prepare(
        `INSERT INTO ingest_runs (game_id, source, added, duplicates, rejected, log)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(gameId, source, added, duplicates, rejected, JSON.stringify(log.slice(0, 100)));
  }

  latestFor(gameId: GameId): { ran_at: string; added: number; source: string } | null {
    return (
      (this.db
        .prepare(`SELECT ran_at, added, source FROM ingest_runs WHERE game_id = ? ORDER BY ran_at DESC LIMIT 1`)
        .get(gameId) as { ran_at: string; added: number; source: string } | undefined) ?? null
    );
  }
}
