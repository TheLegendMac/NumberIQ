/**
 * Fetches the Florida Lottery's own published winning-number history PDFs —
 * the same files linked from their public "Winning Number History" page.
 *
 * Deliberately conservative: one request per game per sync, a descriptive
 * User-Agent, a local cache so repeated analysis never re-hits their servers,
 * and no attempt to access anything that isn't publicly published.
 */
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = join(HERE, '../../../data');
export const CACHE_DIR = join(DATA_DIR, 'cache');

const BASE_URL = 'https://files.floridalottery.com/exptkt';
const USER_AGENT = 'NumberIQ/1.0 (personal-use lottery analytics; local-first)';
const TIMEOUT_MS = 60_000;

export function cachePathFor(sourceFile: string): string {
  return join(CACHE_DIR, `${sourceFile}.pdf`);
}

export function cacheAgeMs(sourceFile: string): number | null {
  const p = cachePathFor(sourceFile);
  if (!existsSync(p)) return null;
  return Date.now() - statSync(p).mtimeMs;
}

/** Download a game's official history PDF into the local cache. */
export async function downloadGamePdf(sourceFile: string): Promise<string> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const url = `${BASE_URL}/${sourceFile}.pdf`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/pdf' },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Florida Lottery returned HTTP ${res.status} for ${sourceFile}.pdf`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000 || buf.subarray(0, 4).toString() !== '%PDF') {
      throw new Error(`Response for ${sourceFile}.pdf was not a PDF (${buf.length} bytes)`);
    }
    const path = cachePathFor(sourceFile);
    writeFileSync(path, buf);
    return path;
  } finally {
    clearTimeout(timer);
  }
}
