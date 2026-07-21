/**
 * Development probe: run the layout engine + grammars against real PDFs and
 * report parse yield per game. Used to validate ingest against live source files.
 *
 *   npx tsx server/src/ingest/probe.ts [maxPages]
 */
import { readFileSync, existsSync } from 'node:fs';
import { GAME_LIST, validateDraw, getGame } from '@numberiq/shared';
import { extractRecordTokens } from './pdf-layout.js';
import { applyGrammar } from './grammars.js';
import { cachePathFor, downloadGamePdf } from './fetch.js';

const maxPages = Number(process.argv[2] ?? 3);

for (const game of GAME_LIST) {
  const path = cachePathFor(game.sourceFile);
  if (!existsSync(path)) await downloadGamePdf(game.sourceFile);

  const data = new Uint8Array(readFileSync(path));
  const records = await extractRecordTokens(data, { maxPages });
  const { draws, failures } = applyGrammar(game.id, records, 'probe');

  const invalid: string[] = [];
  for (const d of draws) {
    const issues = validateDraw(getGame(game.id), d);
    if (issues.length) invalid.push(`${d.drawDate}/${d.drawSlot} ${d.numbers.join('-')}: ${issues[0]!.message}`);
  }

  const sample = draws[0];
  console.log(
    `${game.name.padEnd(21)} runs=${String(records.length).padStart(4)} ` +
    `draws=${String(draws.length).padStart(4)} fail=${String(failures.length).padStart(3)} ` +
    `invalid=${String(invalid.length).padStart(3)}  ` +
    (sample ? `e.g. ${sample.drawDate} ${sample.drawSlot} [${sample.numbers.join(',')}] ${JSON.stringify(sample.extras)}` : ''),
  );
  for (const f of failures.slice(0, 2)) console.log(`    ✗ ${f.reason}: ${f.tokens.join(' ')}`);
  for (const v of invalid.slice(0, 2)) console.log(`    ! ${v}`);
}
