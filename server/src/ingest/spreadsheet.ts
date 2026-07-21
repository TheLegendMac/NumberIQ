/**
 * CSV / Excel import fallback.
 *
 * Deliberately forgiving about *shape* and strict about *values*: column names are
 * fuzzy-matched and numbers can arrive in one delimited column or several, but every
 * resulting record still passes through the same validator as PDF ingest. There is
 * no path into the database that skips validation.
 */
import * as XLSX from 'xlsx';
import { getGame, type GameId, type RawDraw } from '@numberiq/shared';
import { parseLotteryDate } from './pdf-layout.js';

export interface SheetParseResult {
  draws: RawDraw[];
  issues: string[];
  /** Which column each field was resolved to, so the user can confirm the mapping. */
  mapping: Record<string, string>;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const DATE_KEYS = ['drawdate', 'date', 'draw', 'winningdate', 'drawndate'];
const SLOT_KEYS = ['drawslot', 'slot', 'drawtype', 'type', 'time', 'draw'];
const NUMBERS_KEYS = ['numbers', 'winningnumbers', 'balls', 'winningnumber', 'result', 'results'];
const EXTRA_KEYS: Record<string, string[]> = {
  powerball: ['powerball', 'pb', 'powerballnumber', 'redball'],
  megaBall: ['megaball', 'mb', 'megaballnumber'],
  cashBall: ['cashball', 'cb', 'cashballnumber'],
};

function findColumn(headers: string[], candidates: string[]): string | null {
  const normalized = headers.map((h) => ({ raw: h, n: norm(h) }));
  for (const c of candidates) {
    const exact = normalized.find((h) => h.n === c);
    if (exact) return exact.raw;
  }
  for (const c of candidates) {
    const partial = normalized.find((h) => h.n.includes(c));
    if (partial) return partial.raw;
  }
  return null;
}

/** Excel serial dates, JS Dates, and every string format the Lottery uses. */
function coerceDate(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') {
    // Excel serial: days since 1899-12-30.
    const ms = Math.round((value - 25569) * 86_400_000);
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const viaLottery = parseLotteryDate(s);
  if (viaLottery) return viaLottery;
  const parsed = Date.parse(s);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
}

function coerceSlot(value: unknown, gameId: GameId): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).toLowerCase().replace(/[^a-z]/g, '');
  if (!s) return null;
  if (s.startsWith('mid') || s === 'm' || s === 'day') return 'midday';
  if (s.startsWith('eve') || s === 'e' || s === 'night') return 'evening';
  if (s.startsWith('morn')) return 'morning';
  if (s.startsWith('mat')) return 'matinee';
  if (s.startsWith('after')) return 'afternoon';
  if (s.includes('late')) return 'late_night';
  if (s.includes('double') || s === 'dp') return 'double_play';
  if (s === 'main' || s.includes('regular')) return 'main';
  return getGame(gameId).slots.includes(s) ? s : null;
}

function extractNumbers(row: Record<string, unknown>, headers: string[], numbersCol: string | null): number[] {
  if (numbersCol) {
    const raw = row[numbersCol];
    if (typeof raw === 'number') return [raw];
    const parts = String(raw ?? '')
      .split(/[\s,;\-|]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    const nums = parts.map(Number).filter((n) => Number.isFinite(n));
    if (nums.length > 0) return nums;
  }
  // Fall back to positional columns: N1, N2, ... / Ball1, Ball2, ...
  const positional = headers
    .filter((h) => /^(n|no|num|number|ball|b|d|digit|pos)\s*_?\d+$/i.test(h.trim()))
    .sort((a, b) => {
      const na = Number(a.replace(/\D+/g, ''));
      const nb = Number(b.replace(/\D+/g, ''));
      return na - nb;
    });
  return positional.map((h) => Number(row[h])).filter((n) => Number.isFinite(n));
}

/** Parse a CSV or Excel buffer into raw draws for one game. */
export function parseSpreadsheet(buffer: Buffer, gameId: GameId, filename: string): SheetParseResult {
  const game = getGame(gameId);
  const wb = XLSX.read(buffer, { cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { draws: [], issues: ['Workbook contains no sheets'], mapping: {} };

  const sheet = wb.Sheets[sheetName]!;
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  if (rows.length === 0) return { draws: [], issues: ['Sheet is empty'], mapping: {} };

  const headers = Object.keys(rows[0]!);
  const dateCol = findColumn(headers, DATE_KEYS);
  const slotCol = findColumn(headers, SLOT_KEYS);
  const numbersCol = findColumn(headers, NUMBERS_KEYS);
  const extraKey = game.extraBall?.key;
  const extraCol = extraKey ? findColumn(headers, EXTRA_KEYS[extraKey] ?? [norm(extraKey)]) : null;

  const mapping: Record<string, string> = {};
  if (dateCol) mapping.drawDate = dateCol;
  if (slotCol) mapping.drawSlot = slotCol;
  if (numbersCol) mapping.numbers = numbersCol;
  if (extraCol && extraKey) mapping[extraKey] = extraCol;

  const issues: string[] = [];
  if (!dateCol) {
    return {
      draws: [],
      issues: [`Could not find a date column. Looked for: ${DATE_KEYS.join(', ')}. Found: ${headers.join(', ')}`],
      mapping,
    };
  }

  const draws: RawDraw[] = [];
  const defaultSlot = game.slots.length === 1 ? game.slots[0]! : game.slots[game.slots.length - 1]!;

  rows.forEach((row, i) => {
    const drawDate = coerceDate(dateCol ? row[dateCol] : null);
    if (!drawDate) {
      issues.push(`Row ${i + 2}: unreadable date "${String(row[dateCol!])}"`);
      return;
    }
    const numbers = extractNumbers(row, headers, numbersCol);
    if (numbers.length === 0) {
      issues.push(`Row ${i + 2}: no numbers found`);
      return;
    }
    const slot = (slotCol ? coerceSlot(row[slotCol], gameId) : null) ?? defaultSlot;

    const extras: Record<string, number> = {};
    if (extraCol && extraKey) {
      const v = Number(row[extraCol]);
      if (Number.isFinite(v)) extras[extraKey] = v;
    }

    draws.push({ gameId, drawDate, drawSlot: slot, numbers, extras, source: `import:${filename}` });
  });

  return { draws, issues, mapping };
}
