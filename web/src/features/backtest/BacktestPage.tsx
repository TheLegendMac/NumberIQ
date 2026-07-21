import { useEffect, useState, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';
import { primaryDrawSlot, type GameId } from '@numberiq/shared';
import { api, dateLabel, money, pct, slotLabel, type GameSummary } from '../../lib/api.js';
import { latestDataDate } from '../../lib/gameData.js';
import { Button, Card, Chip, Field, Input, Notice, Select, ErrorBox, Fold, Meter } from '../../components/ui.js';
import { Term, Reading } from '../../components/Term.js';

interface Props { games: GameSummary[]; gameId: GameId; setGameId: (id: GameId) => void }

// Fixed order, never cycled. Validated for both surfaces with the dataviz
// palette validator; the results table beside the chart supplies the "relief"
// the light-mode contrast warning requires.
const SERIES_COLORS = [
  'var(--series-1)', 'var(--series-2)', 'var(--series-3)',
  'var(--series-4)', 'var(--series-5)', 'var(--series-6)',
];

export function BacktestPage({ games, gameId, setGameId }: Props) {
  const game = games.find((g) => g.id === gameId)!;
  const [slot, setSlot] = useState(primaryDrawSlot(game));
  const [selected, setSelected] = useState<string[]>(['balanced', 'hot', 'overdue']);
  const [maxDraws, setMaxDraws] = useState(500);
  const [progress, setProgress] = useState<{ completed: number; total: number; label: string } | null>(null);
  const [resultKey, setResultKey] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const currentSlot = game.slots.includes(slot) ? slot : primaryDrawSlot(game);
  const dataThrough = latestDataDate(game.data, currentSlot);
  const strategies = useQuery({ queryKey: ['strategies', gameId], queryFn: () => api.strategies(gameId) });
  const configKey = JSON.stringify([gameId, currentSlot, [...selected].sort(), maxDraws]);

  const run = useMutation({
    mutationFn: ({ body }: { key: string; body: Record<string, unknown> }) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setProgress({ completed: 0, total: 1, label: 'Starting…' });
      return api.backtest(body, setProgress, ctrl.signal);
    },
    onSuccess: (_result, variables) => setResultKey(variables.key),
    onSettled: () => setProgress(null),
  });

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    run.reset();
    setResultKey(null);
    setProgress(null);
    return () => abortRef.current?.abort();
  }, [configKey]);

  const result = resultKey === configKey ? run.data : undefined;
  const allSame = result?.strategies.every((s) => s.verdict === 'not_distinguishable') ?? false;
  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <>
      <header className="page-head">
        <h1>Backtest</h1>
        <p>Play a strategy against real history and see whether it beat pure chance.</p>
      </header>

      <Card>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field label="Game">
            <Select
              value={gameId}
              onChange={(e) => {
                const next = e.target.value as GameId;
                setGameId(next);
                setSlot(primaryDrawSlot(games.find((x) => x.id === next)!));
                setSelected(['balanced', 'hot', 'overdue']);
              }}
              style={{ minWidth: 170 }}
            >
              {games.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </Select>
          </Field>
          {game.slots.length > 1 && (
            <Field label="Drawing">
              <Select value={currentSlot} onChange={(e) => setSlot(e.target.value)} style={{ minWidth: 130 }}>
                {game.slots.map((s) => <option key={s} value={s}>{slotLabel(game, s)}</option>)}
              </Select>
            </Field>
          )}
          {dataThrough && <Chip>Data current through {dateLabel(dataThrough)}</Chip>}
          <Field label="Drawings to test" hint="Most recent N">
            <Input
              type="number" min={50} max={5000} step={50} value={maxDraws}
              onChange={(e) => setMaxDraws(Math.max(50, Math.min(5000, Number(e.target.value) || 500)))}
              style={{ width: 110 }}
            />
          </Field>
          {run.isPending ? (
            <Button onClick={() => abortRef.current?.abort()}>Cancel</Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => run.mutate({
                key: configKey,
                body: {
                  gameId, slot: currentSlot, strategies: selected,
                  ticketsPerDraw: 1, maxDraws, minHistory: 200, nullReplications: 300, seed: 12345,
                },
              })}
              disabled={selected.length === 0 || strategies.isLoading}
            >
              Run backtest
            </Button>
          )}
        </div>

        <div style={{ marginTop: 14 }}>
          <span className="field-label">Strategies to test</span>
          <div className="row-tight" style={{ marginTop: 7 }}>
            {strategies.data?.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => toggle(s.id)}
                className={`chip ${selected.includes(s.id) ? 'chip-accent' : ''}`}
                style={{ cursor: 'pointer' }}
                aria-pressed={selected.includes(s.id)}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>

        {/* Real progress from the worker, not an indeterminate spinner. */}
        {progress && (
          <div style={{ marginTop: 16 }}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{progress.label}</span>
              <span className="num" style={{ fontSize: 12, color: 'var(--muted-2)' }}>
                {Math.round((progress.completed / Math.max(1, progress.total)) * 100)}%
              </span>
            </div>
            <Meter
              value={(progress.completed / Math.max(1, progress.total)) * 100}
              label={progress.label}
            />
            <p className="inline-note" style={{ marginTop: 6 }}>
              Running in a background thread — the page stays responsive.
            </p>
          </div>
        )}
      </Card>

      {strategies.isError && (
        <div style={{ marginTop: 14 }}><ErrorBox error={strategies.error} /></div>
      )}

      {run.isError && !(run.error as { cancelled?: boolean }).cancelled && (
        <div style={{ marginTop: 14 }}><ErrorBox error={run.error} /></div>
      )}

      {result && (
        <div className="grid" style={{ gap: 14, marginTop: 14 }}>
          {/* The verdict leads. Reading only this gives you the correct takeaway. */}
          <div className="verdict">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ maxWidth: '64ch' }}>
                <div className="verdict-title">
                  {allSame ? 'Every strategy did the same as random' : 'Mixed result — read the caveats'}
                </div>
                <p className="verdict-sub">
                  {allSame
                    ? `Over ${result.drawsTested.toLocaleString()} drawings, none of these strategies beat simply picking at random. That is the correct result — drawings are independent, so how you choose numbers cannot change how often you win.`
                    : result.summary}
                </p>
              </div>
              <Chip tone={allSame ? 'pos' : 'warn'}>{result.drawsTested.toLocaleString()} drawings</Chip>
            </div>
          </div>

          {/* Plain-language reading per strategy, with the raw figures beneath. */}
          <Card title="What happened to each strategy" sub={`Every strategy bought one ticket per drawing from ${result.window.from} to ${result.window.to}.`}>
            {result.strategies.map((s, i) => {
              const name = strategies.data?.find((x) => x.id === s.strategy)?.name ?? s.strategy;
              return (
                <Reading
                  key={s.strategy}
                  tone={s.verdict === 'not_distinguishable' ? 'pos' : 'warn'}
                  plain={
                    <>
                      <span className="legend-swatch" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length], display: 'inline-block', marginRight: 7 }} />
                      <strong>{name}</strong> spent {money(s.spend)} and won back {money(s.winnings)} —{' '}
                      <span style={{ color: s.net < 0 ? 'var(--neg)' : 'var(--pos)' }}>
                        {s.net < 0 ? `down ${money(Math.abs(s.net))}` : `up ${money(s.net)}`}
                      </span>
                      . {s.verdict === 'not_distinguishable'
                        ? 'Indistinguishable from random.'
                        : s.verdict === 'better_than_random'
                          ? 'Outside the random band — most likely chance.'
                          : 'Below the random band — most likely chance.'}
                    </>
                  }
                  technical={
                    <>ROI {pct(s.roi)} · won {s.winCount} of {s.ticketsPlayed} tickets ({pct(s.winRate, 2)}) ·
                      longest losing streak {s.longestLosingStreak} · p = {s.pValue.toFixed(3)}
                      {s.jackpotHits > 0 ? ` · ${s.jackpotHits} jackpot-tier hit(s)` : ''}</>
                  }
                />
              );
            })}

            <div style={{ marginTop: 14 }}>
              <Reading
                tone="neutral"
                plain={
                  <>For comparison, <Term id="nullDistribution">picking purely at random</Term> returned{' '}
                    <strong>{pct(result.nullDistribution.meanRoi)}</strong> on average, and 90% of random runs
                    landed between {pct(result.nullDistribution.p05)} and {pct(result.nullDistribution.p95)}.
                    Anything inside that range is luck, not skill.</>
                }
                technical={<>{result.nullDistribution.replications} simulated random runs · {money(result.costPerTicket)} per ticket</>}
              />
            </div>
          </Card>

          <Card title="Money over time" sub="Every line trends down. That is what a negative-expected-value game looks like drawn out.">
            <div style={{ height: 270 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart margin={{ top: 6, right: 10, left: -6, bottom: 4 }}>
                  <CartesianGrid stroke="var(--grid)" vertical={false} />
                  <XAxis
                    type="number" dataKey="index" stroke="var(--muted-2)" fontSize={11}
                    tickLine={false} axisLine={false} domain={['dataMin', 'dataMax']}
                  />
                  <YAxis
                    stroke="var(--muted-2)" fontSize={11} tickLine={false} axisLine={false}
                    tickFormatter={(v: number) => `$${v}`}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--surface-4)', border: '1px solid var(--border-strong)',
                      borderRadius: 10, fontSize: 12.5, boxShadow: 'var(--sh-3)',
                    }}
                    formatter={(v: number, n) => [money(v), n]}
                    labelFormatter={(l) => `After ${l} drawings`}
                  />
                  <ReferenceLine y={0} stroke="var(--border-strong)" />
                  {result.strategies.map((s, i) => (
                    <Line
                      key={s.strategy}
                      data={s.equityCurve}
                      dataKey="net"
                      name={strategies.data?.find((x) => x.id === s.strategy)?.name ?? s.strategy}
                      stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                      dot={false} strokeWidth={2} isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="legend">
              {result.strategies.map((s, i) => (
                <span className="legend-item" key={s.strategy}>
                  <span className="legend-swatch" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
                  {strategies.data?.find((x) => x.id === s.strategy)?.name ?? s.strategy}
                </span>
              ))}
            </div>
          </Card>

          <Fold summary="The full numbers">
            <div className="table-scroll" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th>Strategy</th><th className="t-right">ROI</th><th className="t-right">Spent</th>
                    <th className="t-right">Won</th><th className="t-right">Net</th>
                    <th className="t-right">Win rate</th><th className="t-right">Worst streak</th>
                    <th className="t-right">p-value</th>
                  </tr>
                </thead>
                <tbody>
                  {result.strategies.map((s) => (
                    <tr key={s.strategy}>
                      <td style={{ fontWeight: 550 }}>{s.strategy}</td>
                      <td className="t-right num" style={{ color: s.roi < 0 ? 'var(--neg)' : 'var(--pos)' }}>{pct(s.roi)}</td>
                      <td className="t-right num">{money(s.spend)}</td>
                      <td className="t-right num">{money(s.winnings)}</td>
                      <td className="t-right num" style={{ color: s.net < 0 ? 'var(--neg)' : 'var(--pos)' }}>{money(s.net)}</td>
                      <td className="t-right num">{pct(s.winRate, 2)}</td>
                      <td className="t-right num">{s.longestLosingStreak}</td>
                      <td className="t-right num">{s.pValue.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Fold>

          <Fold summary="How to read this — and what it can't tell you">
            <ul style={{ margin: '12px 0 0', paddingLeft: 18, fontSize: 12.5, color: 'var(--muted)', display: 'grid', gap: 8 }}>
              {result.caveats.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          </Fold>
        </div>
      )}

      {!result && !run.isPending && (
        <div style={{ marginTop: 14 }}>
          <Notice tone="neutral" icon="i">
            Each strategy is measured against <strong>hundreds</strong> of simulated random runs, not
            one — random beats random half the time, so a single comparison proves nothing. Statistics
            are computed only from drawings <em>before</em> each tested drawing, so no strategy can
            see the future.
          </Notice>
        </div>
      )}
    </>
  );
}
