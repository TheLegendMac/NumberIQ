/**
 * Verify that the hosted database reached the same per-game/per-slot draw date
 * as the freshly ingested local database.
 *
 * Usage:
 *   npx tsx server/src/cli/verify-live-watermarks.ts
 *   npx tsx server/src/cli/verify-live-watermarks.ts https://example.workers.dev
 *
 * NUMBERIQ_LIVE_URL can also override the default deployment origin.
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type Database from 'better-sqlite3';
import { getDb } from '../db/index.js';

const DEFAULT_LIVE_URL = 'https://numberiq.trappers-edge.workers.dev';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface DataWatermark {
  gameId: string;
  slot: string;
  last: string;
}

export interface WatermarkMismatch {
  gameId: string;
  slot: string;
  local: string | null;
  live: string | null;
}

function keyOf(watermark: Pick<DataWatermark, 'gameId' | 'slot'>): string {
  return `${watermark.gameId}\u0000${watermark.slot}`;
}

function assertWatermark(value: unknown, context: string): asserts value is DataWatermark {
  if (!value || typeof value !== 'object') throw new Error(`${context} is not an object.`);

  const row = value as Record<string, unknown>;
  if (typeof row.gameId !== 'string' || row.gameId.length === 0) {
    throw new Error(`${context}.gameId is missing.`);
  }
  if (typeof row.slot !== 'string' || row.slot.length === 0) {
    throw new Error(`${context}.slot is missing.`);
  }
  if (typeof row.last !== 'string' || !ISO_DATE.test(row.last)) {
    throw new Error(`${context}.last is not an ISO date.`);
  }
}

function toUniqueMap(watermarks: DataWatermark[], source: string): Map<string, DataWatermark> {
  const result = new Map<string, DataWatermark>();
  for (const [index, watermark] of watermarks.entries()) {
    assertWatermark(watermark, `${source}[${index}]`);
    const key = keyOf(watermark);
    if (result.has(key)) {
      throw new Error(`${source} contains duplicate data for ${watermark.gameId}/${watermark.slot}.`);
    }
    result.set(key, watermark);
  }
  return result;
}

export function readLocalWatermarks(db: Database.Database): DataWatermark[] {
  return db
    .prepare(
      `SELECT game_id AS gameId, draw_slot AS slot, MAX(draw_date) AS last
         FROM draws
        GROUP BY game_id, draw_slot
        ORDER BY game_id, draw_slot`,
    )
    .all() as DataWatermark[];
}

/** Parse the deliberately small portion of GET /api/games used by verification. */
export function readLiveWatermarks(payload: unknown): DataWatermark[] {
  if (!Array.isArray(payload)) throw new Error('Live /api/games response is not an array.');

  const watermarks: DataWatermark[] = [];
  for (const [gameIndex, value] of payload.entries()) {
    if (!value || typeof value !== 'object') {
      throw new Error(`Live game at index ${gameIndex} is not an object.`);
    }
    const game = value as Record<string, unknown>;
    if (typeof game.id !== 'string' || game.id.length === 0) {
      throw new Error(`Live game at index ${gameIndex} has no id.`);
    }
    if (!Array.isArray(game.data)) {
      throw new Error(`Live game ${game.id} has no data summary.`);
    }

    for (const [slotIndex, value] of game.data.entries()) {
      if (!value || typeof value !== 'object') {
        throw new Error(`Live game ${game.id} data[${slotIndex}] is not an object.`);
      }
      const summary = value as Record<string, unknown>;
      const watermark = { gameId: game.id, slot: summary.slot, last: summary.last };
      assertWatermark(watermark, `Live game ${game.id} data[${slotIndex}]`);
      watermarks.push(watermark);
    }
  }

  // Validate duplicate game/slot summaries before returning them.
  toUniqueMap(watermarks, 'Live watermarks');
  return watermarks;
}

/**
 * Compare the union of local and live keys so missing and unexpected summaries
 * fail just as clearly as stale dates.
 */
export function compareWatermarks(
  local: DataWatermark[],
  live: DataWatermark[],
): WatermarkMismatch[] {
  const localByKey = toUniqueMap(local, 'Local watermarks');
  const liveByKey = toUniqueMap(live, 'Live watermarks');
  const keys = [...new Set([...localByKey.keys(), ...liveByKey.keys()])].sort();

  return keys.flatMap((key) => {
    const localWatermark = localByKey.get(key);
    const liveWatermark = liveByKey.get(key);
    if (localWatermark?.last === liveWatermark?.last) return [];

    const present = localWatermark ?? liveWatermark!;
    return [{
      gameId: present.gameId,
      slot: present.slot,
      local: localWatermark?.last ?? null,
      live: liveWatermark?.last ?? null,
    }];
  });
}

export async function verifyLiveWatermarks(liveBaseUrl: string): Promise<void> {
  const local = readLocalWatermarks(getDb());
  if (local.length === 0) throw new Error('The local database has no drawing watermarks.');

  const endpoint = new URL('/api/games', liveBaseUrl);
  const response = await fetch(endpoint, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Live /api/games returned HTTP ${response.status}.`);
  }

  const live = readLiveWatermarks(await response.json());
  const mismatches = compareWatermarks(local, live);
  if (mismatches.length > 0) {
    const detail = mismatches
      .map(({ gameId, slot, local, live }) =>
        `  ${gameId}/${slot}: local=${local ?? 'missing'}, live=${live ?? 'missing'}`,
      )
      .join('\n');
    throw new Error(`Live drawing watermarks do not match local ingest:\n${detail}`);
  }

  console.log(`Verified ${local.length} live game/slot watermarks:`);
  for (const watermark of local) {
    console.log(`  ${`${watermark.gameId}/${watermark.slot}`.padEnd(32)} ${watermark.last}`);
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const liveBaseUrl = process.argv[2] ?? process.env.NUMBERIQ_LIVE_URL ?? DEFAULT_LIVE_URL;
  verifyLiveWatermarks(liveBaseUrl).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
