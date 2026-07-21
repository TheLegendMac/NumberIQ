/**
 * The single ingest pipeline. Every source — official PDF, CSV, Excel — converges
 * here, so validation, deduplication and reporting behave identically regardless
 * of where the data came from.
 */
import { readFileSync, existsSync } from 'node:fs';
import type Database from 'better-sqlite3';
import { getGame, validateDraw, type GameId, type RawDraw } from '@numberiq/shared';
import { extractRecordTokens } from './pdf-layout.js';
import { applyGrammar } from './grammars.js';
import { cachePathFor, downloadGamePdf } from './fetch.js';
import { DrawRepository, IngestRunRepository } from '../db/repositories.js';

export interface IngestReport {
  gameId: GameId;
  source: string;
  parsed: number;
  added: number;
  duplicates: number;
  rejected: number;
  /** Human-readable reasons, capped for display. */
  issues: string[];
  slots: Record<string, number>;
}

/**
 * Validate a batch, dropping bad records with reasons and collapsing exact
 * in-batch duplicates (the PDFs occasionally repeat a row across a page break).
 */
export function validateBatch(
  gameId: GameId,
  draws: RawDraw[],
): { valid: RawDraw[]; rejected: RawDraw[]; issues: string[] } {
  const game = getGame(gameId);
  const valid: RawDraw[] = [];
  const rejected: RawDraw[] = [];
  const issues: string[] = [];
  const seen = new Set<string>();

  for (const d of draws) {
    const problems = validateDraw(game, d);
    if (problems.length > 0) {
      rejected.push(d);
      issues.push(`${d.drawDate} ${d.drawSlot}: ${problems.map((p) => p.message).join('; ')}`);
      continue;
    }
    const key = `${d.drawDate}|${d.drawSlot}`;
    if (seen.has(key)) continue; // in-batch duplicate, silently collapsed
    seen.add(key);
    valid.push(d);
  }
  return { valid, rejected, issues };
}

/** Ingest a set of already-parsed draws. */
export function ingestDraws(
  db: Database.Database,
  gameId: GameId,
  draws: RawDraw[],
  source: string,
): IngestReport {
  const { valid, rejected, issues } = validateBatch(gameId, draws);
  const repo = new DrawRepository(db);
  const { added, duplicates } = repo.insertMany(valid);

  const slots: Record<string, number> = {};
  for (const d of valid) slots[d.drawSlot] = (slots[d.drawSlot] ?? 0) + 1;

  new IngestRunRepository(db).record(gameId, source, added, duplicates, rejected.length, issues);

  return {
    gameId,
    source,
    parsed: draws.length,
    added,
    duplicates,
    rejected: rejected.length,
    issues: issues.slice(0, 25),
    slots,
  };
}

export interface SyncOptions {
  /** Reuse a cached PDF newer than this many ms instead of re-downloading. */
  maxCacheAgeMs?: number;
  maxPages?: number;
}

/** Download (or reuse) a game's official PDF and ingest it. */
export async function syncGame(
  db: Database.Database,
  gameId: GameId,
  opts: SyncOptions = {},
): Promise<IngestReport> {
  const game = getGame(gameId);
  const path = cachePathFor(game.sourceFile);
  const maxAge = opts.maxCacheAgeMs ?? 6 * 60 * 60 * 1000;

  let fresh = false;
  if (existsSync(path)) {
    const age = Date.now() - (await import('node:fs')).statSync(path).mtimeMs;
    fresh = age < maxAge;
  }
  if (!fresh) await downloadGamePdf(game.sourceFile);

  const data = new Uint8Array(readFileSync(path));
  const records = await extractRecordTokens(data, opts.maxPages ? { maxPages: opts.maxPages } : {});
  const { draws, failures } = applyGrammar(gameId, records, `official:${game.sourceFile}.pdf`);

  const report = ingestDraws(db, gameId, draws, `official:${game.sourceFile}.pdf`);

  // A format change shows up as parse failures. Surface it rather than hide it.
  if (failures.length > 0) {
    report.rejected += failures.length;
    report.issues.unshift(
      `${failures.length} record(s) did not match the expected layout — the source PDF format may have changed.`,
      ...failures.slice(0, 5).map((f) => `  unparsed: ${f.reason} → ${f.tokens.join(' ')}`),
    );
  }
  if (draws.length === 0) {
    report.issues.unshift('No draws were extracted. The source PDF layout has likely changed.');
  }
  return report;
}

// ---------------------------------------------------------------------------
// Gap / consistency analysis
// ---------------------------------------------------------------------------

export interface GapReport {
  slot: string;
  count: number;
  first: string | null;
  last: string | null;
  /** Calendar dates with no draw where the schedule implies one should exist. */
  missing: string[];
  /** True when dates are stored out of order (should be impossible). */
  outOfOrder: boolean;
  expectedPerWeek: number;
  /** The date range actually scanned for gaps, and why. */
  scanWindow: { from: string; to: string; note: string } | null;
}

const DAY_MS = 86_400_000;

function isoAddDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** How far back to look for missing draws. */
const GAP_SCAN_DAYS = 730;
/** How many recent draws to infer the current weekday schedule from. */
const SCHEDULE_SAMPLE = 180;

/**
 * Detect missing draws.
 *
 * Drawing schedules change: Powerball added Monday draws in 2021, Cash4Life moved
 * from twice-weekly to daily, Fantasy 5 and the Pick games added Midday draws.
 * Inferring the weekday pattern from *all* history and projecting it backwards
 * therefore invents thousands of "missing" draws that were never scheduled — a
 * false alarm far worse than reporting nothing.
 *
 * So we infer the schedule from recent draws only, and scan only the window over
 * which that schedule plausibly held. The scanned range is reported alongside the
 * result so the scope is explicit rather than implied.
 */
export function analyzeGaps(db: Database.Database, gameId: GameId): GapReport[] {
  const game = getGame(gameId);
  const repo = new DrawRepository(db);
  const reports: GapReport[] = [];

  for (const slot of game.slots) {
    const dates = repo.dates(gameId, slot);
    const perSlotPerWeek = game.drawsPerWeek / game.slots.length;

    if (dates.length === 0) {
      reports.push({
        slot, count: 0, first: null, last: null, missing: [],
        outOfOrder: false, expectedPerWeek: perSlotPerWeek, scanWindow: null,
      });
      continue;
    }

    const outOfOrder = dates.some((d, i) => i > 0 && d < dates[i - 1]!);
    const present = new Set(dates);
    const first = dates[0]!;
    const last = dates[dates.length - 1]!;

    const scanFrom = [first, isoAddDays(last, -GAP_SCAN_DAYS)].sort()[1]!;
    const recent = dates.slice(-SCHEDULE_SAMPLE);
    const missing: string[] = [];

    if (perSlotPerWeek >= 6.5) {
      for (let d = scanFrom; d <= last; d = isoAddDays(d, 1)) {
        if (!present.has(d)) missing.push(d);
      }
    } else {
      // Weekday pattern of the *current* schedule only.
      const weekdayCounts = new Array<number>(7).fill(0);
      for (const d of recent) weekdayCounts[new Date(`${d}T00:00:00Z`).getUTCDay()]!++;
      const threshold = recent.length / 20;
      const drawDays = new Set(
        weekdayCounts.map((c, i) => (c > threshold ? i : -1)).filter((i) => i >= 0),
      );
      for (let d = scanFrom; d <= last; d = isoAddDays(d, 1)) {
        const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
        if (drawDays.has(wd) && !present.has(d)) missing.push(d);
      }
    }

    reports.push({
      slot,
      count: dates.length,
      first,
      last,
      missing: missing.slice(0, 500),
      outOfOrder,
      expectedPerWeek: perSlotPerWeek,
      scanWindow: {
        from: scanFrom,
        to: last,
        note:
          scanFrom === first
            ? 'Full history scanned.'
            : `Scanned the last ${GAP_SCAN_DAYS} days. Earlier periods are skipped because drawing schedules have changed over the game's history.`,
      },
    });
  }
  return reports;
}
