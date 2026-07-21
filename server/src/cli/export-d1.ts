/**
 * Export the local drawing history as SQL for D1.
 *
 * Ingest deliberately stays local: parsing ~87k drawings out of the Lottery's
 * PDFs is far beyond a Worker's CPU budget, and an open sync endpoint would let
 * anyone point this deployment at the Lottery's servers. So the flow is:
 *
 *   1. npx tsx server/src/cli/seed.ts        (download + parse locally)
 *   2. npm run d1:export                     (this file -> data/d1-seed.sql)
 *   3. npm run d1:push                       (wrangler executes it remotely)
 *
 * Statements are chunked into multi-row INSERTs to stay well inside D1's
 * per-batch statement limits and to keep the upload a reasonable size.
 *
 * `--since=<days>` exports only recent drawings. The scheduled refresh uses this:
 * re-pushing all ~87k rows every night would burn D1's daily write allowance for
 * no benefit. The conflict guard makes unchanged rows a no-op while still
 * applying late corrections from the Lottery, so the window is deliberately
 * wider than a day to cover a missed run or delayed correction.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '../db/index.js';
import { DATA_DIR } from '../ingest/fetch.js';
import { renderD1SeedSql, type D1DrawRow } from './d1-export-sql.js';

const ROWS_PER_INSERT = 200;

const sinceArg = process.argv.find((a) => a.startsWith('--since='));
const sinceDays = sinceArg ? Number(sinceArg.split('=')[1]) : null;
const sinceDate = sinceDays
  ? new Date(Date.now() - sinceDays * 86_400_000).toISOString().slice(0, 10)
  : null;

const db = getDb();
const rows = db
  .prepare(
    `SELECT game_id, draw_date, draw_slot, numbers, extras, source FROM draws
     ${sinceDate ? 'WHERE draw_date >= @since' : ''}
     ORDER BY game_id, draw_slot, draw_date`,
  )
  .all(sinceDate ? { since: sinceDate } : {}) as D1DrawRow[];

if (rows.length === 0) {
  if (sinceDate) {
    // Nothing new is a normal outcome for a scheduled run, not a failure.
    console.log(`No drawings on or after ${sinceDate}. Nothing to publish.`);
    process.exit(0);
  }
  console.error('No drawings in the local database. Run: npx tsx server/src/cli/seed.ts');
  process.exit(1);
}

const sql = renderD1SeedSql(rows, ROWS_PER_INSERT);

mkdirSync(DATA_DIR, { recursive: true });
const path = join(DATA_DIR, 'd1-seed.sql');
writeFileSync(path, sql);

const bytes = Buffer.byteLength(sql);
console.log(
  `Exported ${rows.length.toLocaleString()} drawings${sinceDate ? ` since ${sinceDate}` : ''} → ${path}\n` +
  `${(bytes / 1_048_576).toFixed(1)} MB across ${Math.ceil(rows.length / ROWS_PER_INSERT)} INSERT statements.\n\n` +
  `Next: npm run d1:push`,
);
