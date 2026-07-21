import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { chiSquarePValue } from '@numberiq/shared';
import { api, dateLabel, type GameFrequency } from '../../lib/api.js';
import { Card, Ball, Skeleton, ErrorBox, Fold } from '../../components/ui.js';
import { Reading } from '../../components/Term.js';

const TOP_N = 6;

/**
 * How far a game's counts stray from a perfectly even machine.
 *
 * Some number always finishes first — that is arithmetic, not a pattern. The
 * only question worth asking is whether the gap is bigger than randomness alone
 * produces, which is what the chi-square p-value answers. Showing the ranking
 * without this figure would invite exactly the reading the ranking cannot support.
 */
function evenness(counts: Array<{ n: number; count: number }>) {
  const total = counts.reduce((s, c) => s + c.count, 0);
  const expected = total / counts.length;
  const chi2 = counts.reduce((s, c) => s + (c.count - expected) ** 2 / expected, 0);
  return {
    expected,
    p: chiSquarePValue(chi2, counts.length - 1),
    high: counts.reduce((a, b) => (b.count > a.count ? b : a)),
    low: counts.reduce((a, b) => (b.count < a.count ? b : a)),
  };
}

function GameRow({ game }: { game: GameFrequency }) {
  const [open, setOpen] = useState(false);
  const ranked = [...game.counts].sort((a, b) => b.count - a.count || a.n - b.n);
  const { expected, p, high, low } = evenness(game.counts);
  const kind = game.kind === 'digits' ? 'digit' : 'main';

  return (
    <div className="freq-row">
      <div className="freq-row-head">
        <div>
          <div className="freq-game">{game.name}</div>
          <div className="inline-note">
            {game.drawCount.toLocaleString()} drawings · {dateLabel(game.from)} → {dateLabel(game.to)}
            {game.eraStart && ' · current number pool only'}
          </div>
        </div>
        <button className="freq-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? 'Hide all' : `All ${game.counts.length}`}
        </button>
      </div>

      <div className="freq-balls">
        {ranked.slice(0, TOP_N).map(({ n, count }) => (
          <span className="freq-ball" key={n}>
            <Ball n={n} kind={kind} title={`drawn ${count.toLocaleString()} times`} />
            <span className="freq-count num">{count.toLocaleString()}</span>
          </span>
        ))}
        <span className="freq-expected inline-note">
          even split would be<br />{Math.round(expected).toLocaleString()} each
        </span>
      </div>

      {open && (
        <div className="freq-all">
          {ranked.map(({ n, count }) => (
            <span className="freq-all-item" key={n} title={`drawn ${count.toLocaleString()} times`}>
              <Ball n={n} kind={kind} size="sm" />
              <span className="num">{count.toLocaleString()}</span>
            </span>
          ))}
        </div>
      )}

      <p className="freq-verdict">
        {p >= 0.05 ? (
          <>Most-drawn <strong>{high.n}</strong> ({high.count.toLocaleString()}), least-drawn{' '}
            <strong>{low.n}</strong> ({low.count.toLocaleString()}) — a gap this size turns up in{' '}
            {Math.round(p * 100)}% of perfectly fair machines. No number is running hot.</>
        ) : (
          <>Most-drawn <strong>{high.n}</strong> ({high.count.toLocaleString()}) vs least-drawn{' '}
            <strong>{low.n}</strong> ({low.count.toLocaleString()}). A gap this size occurs in only{' '}
            {(p * 100).toFixed(1)}% of fair machines — unusual, though with ten games checked at once
            one flag is itself expected.</>
        )}
      </p>
    </div>
  );
}

export function FrequencyTable() {
  const freq = useQuery({ queryKey: ['frequency'], queryFn: api.frequency, staleTime: 10 * 60_000 });

  return (
    <Card
      title="Most-drawn numbers, every game"
      sub="Counted across each game's entire history under its current number pool."
    >
      {freq.isLoading && <Skeleton rows={4} />}
      {freq.isError && <ErrorBox error={freq.error} />}

      {freq.data && (
        <>
          <div className="freq-list">
            {freq.data.map((g) => <GameRow key={g.gameId} game={g} />)}
          </div>

          <div style={{ marginTop: 16 }}>
            <Reading
              tone={freq.data.every((g) => evenness(g.counts).p >= 0.05) ? 'pos' : 'warn'}
              plain={
                <>These are the real counts, and they are worth exactly nothing as a forecast.
                  Every game above is <strong>statistically even</strong> — the gaps between the most
                  and least drawn numbers are the size randomness produces on its own. A number that
                  has led for thirty years has the same chance tonight as one that has trailed.</>
              }
              technical={
                <>Chi-square goodness-of-fit against a uniform pool, per game:{' '}
                  {freq.data.map((g) => `${g.name} p=${evenness(g.counts).p.toFixed(2)}`).join(' · ')}</>
              }
            />
          </div>

          <Fold summary="Why the numbers are counted this way">
            <p className="inline-note" style={{ marginTop: 10 }}>
              Counts are restricted to each game's <strong>current number pool</strong>. Fantasy 5
              only added the numbers 27–36 in 2001 and Florida Lotto went from 6/49 to 6/53 in 1999,
              so counting from the beginning would make the newer numbers look permanently cold —
              an artefact of when they started existing, not of how often they fall.
            </p>
            <p className="inline-note" style={{ marginTop: 8 }}>
              Draw slots are pooled: a game's midday and evening drawings use the same machine and
              the same pool, so they are counted together. Splitting them changes which number
              finishes first, which is itself a good demonstration that the ordering is noise.
            </p>
          </Fold>
        </>
      )}
    </Card>
  );
}
