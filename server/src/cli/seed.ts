/**
 * Ingest official history into the local database.
 *
 *   npx tsx server/src/cli/seed.ts            # all games
 *   npx tsx server/src/cli/seed.ts fantasy5   # one game
 */
import { GAME_LIST, isGameId } from '@numberiq/shared';
import { getDb } from '../db/index.js';
import { syncGame, analyzeGaps } from '../ingest/pipeline.js';

const requested = process.argv.slice(2).filter(isGameId);
const games = requested.length ? GAME_LIST.filter((g) => requested.includes(g.id)) : GAME_LIST;
const db = getDb();

for (const game of games) {
  const started = Date.now();
  try {
    const report = await syncGame(db, game.id);
    const gaps = analyzeGaps(db, game.id);
    const missing = gaps.reduce((s, g) => s + g.missing.length, 0);
    console.log(
      `${game.name.padEnd(21)} +${String(report.added).padStart(6)} added  ` +
      `${String(report.duplicates).padStart(6)} dup  ${String(report.rejected).padStart(4)} rejected  ` +
      `${String(missing).padStart(5)} gaps  ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
    for (const issue of report.issues.slice(0, 3)) console.log(`    ! ${issue}`);
  } catch (err) {
    console.error(`${game.name.padEnd(21)} FAILED: ${(err as Error).message}`);
  }
}
