/**
 * Geometric text extraction for Florida Lottery winning-number history PDFs.
 *
 * These PDFs come in two visual families:
 *
 *   A. Modern single-column tables (Powerball, Fantasy 5, Cash Pop, Triple Play)
 *   B. Legacy multi-column layouts (Pick 2-5, Cash4Life, Mega Millions, Lotto)
 *      where 2-3 independent record columns sit side by side on one page.
 *
 * Both are handled by the same pipeline, because the only real differences are
 * how many record columns a page has and what the token grammar looks like:
 *
 *   1. Pull raw positioned text items from the PDF text layer.
 *   2. Cluster items into visual lines by y, with tolerance. This matters: a
 *      single record's tokens are rendered with up to ~1pt of y jitter (baseline
 *      shifts for labels like "FB"/"MB"), so exact-y grouping shatters one record
 *      into three fragments. Tolerance-based clustering is what makes this work.
 *   3. Detect record-column x boundaries from where date tokens actually land.
 *   4. Split each line into per-column token runs, x-sorted.
 *
 * The output is a flat list of token arrays, one per record, which a per-game
 * grammar then interprets.
 */

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface PositionedToken {
  x: number;
  y: number;
  s: string;
}

/** Matches both `07/19/26` and `7/19/2026`. */
export const DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/;

/** Vertical tolerance, in points, for treating two items as the same visual line. */
const Y_TOLERANCE = 3;

/** Ignore leader dashes and other pure-punctuation artifacts. */
const NOISE_RE = /^[-–—.·|]+$/;

export interface ExtractOptions {
  /** Stop after N pages (used by tests and format probes). */
  maxPages?: number;
}

/**
 * Extract every record's token run from a PDF buffer.
 * Returns raw string arrays in visual order; grammars do the interpreting.
 */
export async function extractRecordTokens(
  data: Uint8Array,
  opts: ExtractOptions = {},
): Promise<string[][]> {
  const doc = await getDocument({
    data,
    useSystemFonts: true,
    isEvalSupported: false,
    // Suppress pdf.js console noise for these simple text-only documents.
    verbosity: 0,
  }).promise;

  const pageCount = Math.min(opts.maxPages ?? doc.numPages, doc.numPages);
  const records: string[][] = [];

  for (let p = 1; p <= pageCount; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();

    const items: PositionedToken[] = [];
    for (const item of content.items as Array<{ str?: string; transform?: number[] }>) {
      const s = item.str?.trim();
      if (!s || NOISE_RE.test(s)) continue;
      const t = item.transform;
      if (!t) continue;
      items.push({ x: t[4] as number, y: t[5] as number, s });
    }
    if (items.length === 0) continue;

    for (const line of clusterIntoLines(items)) {
      for (const run of splitIntoColumns(line)) {
        // A record must be anchored by a date; everything else is a header,
        // footer, page number or disclaimer.
        if (run.length > 1 && DATE_RE.test(run[0]!)) records.push(run);
      }
    }
    page.cleanup();
  }

  await doc.destroy();
  return records;
}

/**
 * Group positioned items into visual lines, tolerating sub-point baseline jitter.
 * Items are returned x-sorted within each line.
 */
export function clusterIntoLines(items: PositionedToken[]): PositionedToken[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PositionedToken[][] = [];
  let current: PositionedToken[] = [];
  let anchorY = Number.POSITIVE_INFINITY;

  for (const item of sorted) {
    if (current.length === 0 || Math.abs(item.y - anchorY) <= Y_TOLERANCE) {
      if (current.length === 0) anchorY = item.y;
      current.push(item);
    } else {
      lines.push(current.sort((a, b) => a.x - b.x));
      current = [item];
      anchorY = item.y;
    }
  }
  if (current.length > 0) lines.push(current.sort((a, b) => a.x - b.x));
  return lines;
}

/**
 * Split one visual line into independent record columns.
 *
 * Rather than guessing fixed column widths (which vary per game and per page),
 * we use the date tokens themselves as column anchors: every record starts with
 * a date, so each date on a line opens a new column run.
 */
export function splitIntoColumns(line: PositionedToken[]): string[][] {
  const runs: string[][] = [];
  let current: string[] | null = null;

  for (const item of line) {
    if (DATE_RE.test(item.s)) {
      if (current) runs.push(current);
      current = [item.s];
    } else if (current) {
      current.push(item.s);
    }
    // Tokens before the first date on a line are headers — dropped.
  }
  if (current) runs.push(current);
  return runs;
}

/**
 * Convert a lottery date token to ISO `yyyy-mm-dd`.
 * Two-digit years pivot on the Florida Lottery's 1988 launch.
 */
export function parseLotteryDate(token: string): string | null {
  const m = DATE_RE.exec(token);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const rawYear = Number(m[3]);
  const year = m[3]!.length === 4 ? rawYear : rawYear >= 88 ? 1900 + rawYear : 2000 + rawYear;

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  // Reject impossible dates that JS would silently roll over (e.g. 02/30).
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
