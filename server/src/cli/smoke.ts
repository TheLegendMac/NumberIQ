/** End-to-end smoke check of the analysis stack against the seeded database. */
import { getGame } from '@numberiq/shared';
import { getDb } from '../db/index.js';
import { DrawRepository } from '../db/repositories.js';
import { analyzeGaps } from '../ingest/pipeline.js';
import { computeStats } from '@numberiq/shared';
import { runRandomnessAudit } from '@numberiq/shared';
import { generateTickets } from '@numberiq/shared';
import { runBacktest } from '@numberiq/shared';
import { estimatePopularity } from '@numberiq/shared';

const db = getDb();
const repo = new DrawRepository(db);

console.log('=== GAP DETECTION (after schedule-aware fix) ===');
for (const id of ['powerball', 'cash4life', 'fantasy5', 'pick3'] as const) {
  for (const g of analyzeGaps(db, id)) {
    console.log(`  ${id}/${g.slot}: ${g.count} draws, ${g.missing.length} missing in scan window (${g.scanWindow?.from}→${g.scanWindow?.to})`);
  }
}

console.log('\n=== RANDOMNESS AUDIT: Fantasy 5 evening ===');
const f5 = repo.list('fantasy5', 'evening');
const audit = runRandomnessAudit(getGame('fantasy5'), 'evening', f5);
console.log(`  ${audit.drawCount} draws — verdict: ${audit.verdict}`);
for (const t of audit.tests) {
  console.log(`  ${t.significant ? '⚠' : '✓'} ${t.name.padEnd(34)} p=${t.pValue.toFixed(4)}`);
}
console.log(`  ${audit.summary}`);

console.log('\n=== STATS: Fantasy 5 ===');
const stats = computeStats(getGame('fantasy5'), 'evening', f5);
console.log(`  ${stats.drawCount} draws ${stats.first}→${stats.last}, pool ${stats.poolMin}-${stats.poolMax}`);
console.log(`  hottest: ${stats.hot.slice(0, 3).map((h) => `${h.n}(${h.count}, z=${h.z.toFixed(2)})`).join(' ')}`);
console.log(`  sum mean ${stats.sums.mean.toFixed(1)} sd ${stats.sums.stdev.toFixed(1)}`);

console.log('\n=== GENERATION: Fantasy 5, unpopular vs random ===');
for (const strategy of ['unpopular', 'random', 'hot'] as const) {
  const { tickets, batch } = generateTickets({
    game: getGame('fantasy5'), history: f5.slice().reverse(), strategy, count: 3,
    batchMode: 'low_overlap', seed: 42,
  });
  console.log(`  ${strategy.padEnd(10)} ${tickets.map((t) => `[${t.numbers.join(' ')}] ${t.score.total}`).join('  ')} overlap=${batch.averageOverlap.toFixed(2)}`);
}

console.log('\n=== POPULARITY MODEL SANITY ===');
const cases: Array<[string, number[]]> = [
  ['birthday-heavy 1-5', [1, 2, 3, 4, 5]],
  ['all under 31', [3, 7, 12, 19, 25]],
  ['high spread', [8, 19, 27, 33, 36]],
];
for (const [label, nums] of cases) {
  const p = estimatePopularity(getGame('fantasy5'), nums, {});
  console.log(`  ${label.padEnd(20)} index=${p.index.toFixed(1).padStart(5)}  ${p.summary.slice(0, 62)}`);
}
console.log('  (Pick 3 is fixed-payout — model must decline)');
const fixed = estimatePopularity(getGame('pick3'), [1, 2, 3], {});
console.log(`  pick3 index=${fixed.index} → ${fixed.summary.slice(0, 80)}`);

console.log('\n=== BACKTEST: Fantasy 5, 400 draws, 200 null replications ===');
const started = Date.now();
const result = runBacktest(
  {
    game: getGame('fantasy5'), slot: 'evening',
    strategies: ['unpopular', 'hot', 'cold', 'overdue', 'balanced'],
    ticketsPerDraw: 1, maxDraws: 400, minHistory: 200, nullReplications: 200, seed: 7,
  },
  f5,
);
console.log(`  ${result.drawsTested} draws ${result.window.from}→${result.window.to} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(`  null ROI: mean ${(result.nullDistribution.meanRoi * 100).toFixed(1)}%  [p05 ${(result.nullDistribution.p05 * 100).toFixed(1)}%, p95 ${(result.nullDistribution.p95 * 100).toFixed(1)}%]`);
for (const s of result.strategies) {
  console.log(
    `  ${s.strategy.padEnd(12)} ROI ${(s.roi * 100).toFixed(1).padStart(7)}%  ` +
    `pct ${(s.percentileVsRandom * 100).toFixed(0).padStart(3)}  p=${s.pValue.toFixed(3)}  ${s.verdict}`,
  );
}
console.log(`\n  ${result.summary}`);
