import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceArea, Legend } from 'recharts';
import type { GameId } from '@numberiq/shared';
import { api, money, pct, slotLabel, type GameSummary } from '../../lib/api.js';
import { Button, Card, Chip, Field, Input, Notice, Select, Skeleton, ErrorBox, Stat } from '../../components/ui.js';

interface Props { games: GameSummary[]; gameId: GameId; setGameId: (id: GameId) => void }

// Fixed order, never cycled. Steps validated for both surfaces with the dataviz
// palette validator; the results table beside the chart supplies the "relief"
// the light-mode contrast warning requires.
const SERIES_COLORS = [
  'var(--series-1)', 'var(--series-2)', 'var(--series-3)',
  'var(--series-4)', 'var(--series-5)', 'var(--series-6)',
];

export function BacktestPage({ games, gameId, setGameId }: Props) {
  const game = games.find((g) => g.id === gameId)!;
  const [slot, setSlot] = useState(game.slots[game.slots.length - 1]!);
  const [selected, setSelected] = useState<string[]>(['balanced', 'hot', 'overdue']);
  const [maxDraws, setMaxDraws] = useState(500);

  const currentSlot = game.slots.includes(slot) ? slot : game.slots[game.slots.length - 1]!;
  const strategies = useQuery({ queryKey: ['strategies', gameId], queryFn: () => api.strategies(gameId) });

  const run = useMutation({
    mutationFn: () =>
      api.backtest({
        gameId, slot: currentSlot, strategies: selected,
        ticketsPerDraw: 1, maxDraws, minHistory: 200, nullReplications: 300, seed: 12345,
      }),
  });

  const result = run.data;
  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <>
      <header className="page-head">
        <h1>Backtest</h1>
        <p>Run a strategy against real history and compare it against pure chance.</p>
      </header>

      <Card>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field label="Game">
            <Select
              value={gameId}
              onChange={(e) => {
                const next = e.target.value as GameId;
                setGameId(next);
                setSlot(games.find((x) => x.id === next)!.slots.slice(-1)[0]!);
              }}
              style={{ minWidth: 180 }}
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
          <Field label="Draws to test" hint="Most recent N drawings">
            <Input
              type="number" min={50} max={5000} step={50} value={maxDraws}
              onChange={(e) => setMaxDraws(Math.max(50, Math.min(5000, Number(e.target.value) || 500)))}
              style={{ width: 110 }}
            />
          </Field>
          <Button variant="primary" onClick={() => run.mutate()} disabled={run.isPending || selected.length === 0}>
            {run.isPending ? 'Running…' : 'Run backtest'}
          </Button>
        </div>

        <div style={{ marginTop: 14 }}>
          <span className="field-label">Strategies to test</span>
          <div className="row-tight" style={{ marginTop: 7 }}>
            {strategies.data?.map((s) => (
              <button
                key={s.id}
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
      </Card>

      <div style={{ margin: '14px 0' }}>
        <Notice tone="neutral" icon="i">
          Every strategy is measured against a <strong>distribution</strong> of random runs, not a
          single one — random beats random half the time, so one comparison proves nothing.
          Statistics are computed only from draws before each tested drawing, so no strategy can
          see the future.
        </Notice>
      </div>

      {run.isPending && <Card><Skeleton rows={5} /></Card>}
      {run.isError && <ErrorBox error={run.error} />}

      {result && (
        <div className="grid" style={{ gap: 14 }}>
          {/* The verdict leads. A user who reads only this has the right takeaway. */}
          <div className="verdict">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ maxWidth: '70ch' }}>
                <div className="verdict-title">
                  {result.strategies.every((s) => s.verdict === 'not_distinguishable')
                    ? 'No strategy performed differently from random'
                    : 'Mixed result — see the caveats'}
                </div>
                <p className="verdict-sub">{result.summary}</p>
              </div>
              <Chip tone={result.strategies.every((s) => s.verdict === 'not_distinguishable') ? 'pos' : 'warn'}>
                {result.drawsTested.toLocaleString()} draws
              </Chip>
            </div>

            <div className="grid grid-4" style={{ marginTop: 16 }}>
              <Stat label="Window" value={<span style={{ fontSize: 14 }}>{result.window.from} → {result.window.to}</span>} />
              <Stat label="Random baseline ROI" value={pct(result.nullDistribution.meanRoi)} tone="neg" />
              <Stat
                label="Random 90% range"
                value={<span style={{ fontSize: 15 }}>{pct(result.nullDistribution.p05)} to {pct(result.nullDistribution.p95)}</span>}
                hint={`${result.nullDistribution.replications} simulated runs`}
              />
              <Stat label="Cost per ticket" value={money(result.costPerTicket)} />
            </div>
          </div>

          <Card title="Results by strategy" sub="Anything inside the random band is indistinguishable from chance.">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Strategy</th>
                    <th className="t-right">ROI</th>
                    <th className="t-right">Spent</th>
                    <th className="t-right">Won</th>
                    <th className="t-right">Net</th>
                    <th className="t-right">Win rate</th>
                    <th className="t-right">Worst streak</th>
                    <th className="t-right">p-value</th>
                    <th>Verdict</th>
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
                      <td>
                        <Chip tone={s.verdict === 'not_distinguishable' ? 'default' : 'warn'}>
                          {s.verdict === 'not_distinguishable' ? 'Same as random' :
                           s.verdict === 'better_than_random' ? 'Above band' : 'Below band'}
                        </Chip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Net position over time" sub="Every line trends down. That is what a negative-expected-value game looks like.">
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart margin={{ top: 6, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid stroke="var(--grid)" vertical={false} />
                  <XAxis
                    type="number" dataKey="index" {...{ stroke: 'var(--muted-2)', fontSize: 11 }}
                    domain={['dataMin', 'dataMax']}
                    label={{ value: 'Draws elapsed', position: 'insideBottom', offset: -2, fill: 'var(--muted-2)', fontSize: 11 }}
                  />
                  <YAxis {...{ stroke: 'var(--muted-2)', fontSize: 11 }} tickFormatter={(v: number) => `$${v}`} />
                  <Tooltip
                    contentStyle={{ background: 'var(--surface-4)', border: '1px solid var(--border-strong)', borderRadius: 10, fontSize: 12.5, boxShadow: 'var(--sh-3)' }}
                    formatter={(v: number) => money(v)}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <ReferenceArea y1={0} y2={0} stroke="var(--border-strong)" />
                  {result.strategies.map((s, i) => (
                    <Line
                      key={s.strategy}
                      data={s.equityCurve}
                      dataKey="net"
                      name={s.strategy}
                      stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                      dot={false}
                      strokeWidth={2}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="How to read this">
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--muted)', display: 'grid', gap: 7 }}>
              {result.caveats.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          </Card>
        </div>
      )}

      {!result && !run.isPending && (
        <Card>
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>
            Select strategies and run a backtest. Expect them all to land inside the random band —
            that is the correct result, and seeing it directly is more convincing than being told.
          </p>
        </Card>
      )}
    </>
  );
}
