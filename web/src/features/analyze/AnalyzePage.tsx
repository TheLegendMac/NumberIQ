import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, ReferenceLine } from 'recharts';
import type { GameId } from '@numberiq/shared';
import { api, dateLabel, slotLabel, type GameSummary } from '../../lib/api.js';
import { Card, Chip, Field, Notice, Select, Skeleton, Tabs, EmptyState, Ball, Fold } from '../../components/ui.js';
import { Term, Reading } from '../../components/Term.js';
import { readPValue, readZ } from '../../lib/glossary.js';

interface Props { games: GameSummary[]; gameId: GameId; setGameId: (id: GameId) => void }
type Tab = 'frequency' | 'patterns' | 'positions' | 'audit';

const axis = { stroke: 'var(--muted-2)', fontSize: 11, tickLine: false, axisLine: false };
const tooltipStyle = {
  background: 'var(--surface-4)', border: '1px solid var(--border-strong)',
  borderRadius: 10, fontSize: 12.5, boxShadow: 'var(--sh-3)', color: 'var(--text)',
};

export function AnalyzePage({ games, gameId, setGameId }: Props) {
  const game = games.find((g) => g.id === gameId)!;
  const [slot, setSlot] = useState(game.slots[game.slots.length - 1]!);
  const [tab, setTab] = useState<Tab>('frequency');

  const currentSlot = game.slots.includes(slot) ? slot : game.slots[game.slots.length - 1]!;
  const stats = useQuery({ queryKey: ['stats', gameId, currentSlot], queryFn: () => api.stats(gameId, currentSlot) });
  const audit = useQuery({
    queryKey: ['randomness', gameId, currentSlot],
    queryFn: () => api.randomness(gameId, currentSlot),
    enabled: tab === 'audit',
  });

  const s = stats.data;
  const extreme = s ? [...s.numbers].sort((a, b) => Math.abs(b.z) - Math.abs(a.z))[0] : null;

  return (
    <>
      <header className="page-head">
        <h1>Analyze</h1>
        <p>What the history actually shows — in plain English, with the full numbers underneath.</p>
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
              <Select value={currentSlot} onChange={(e) => setSlot(e.target.value)} style={{ minWidth: 140 }}>
                {game.slots.map((x) => <option key={x} value={x}>{slotLabel(game, x)}</option>)}
              </Select>
            </Field>
          )}
          {s && (
            <div className="row-tight" style={{ marginLeft: 'auto' }}>
              <Chip tone="accent">{s.drawCount.toLocaleString()} drawings</Chip>
              {s.first && <Chip>{dateLabel(s.first)} → {dateLabel(s.last!)}</Chip>}
            </div>
          )}
        </div>
      </Card>

      {/* The single most important sentence on the page. */}
      <div style={{ margin: '14px 0' }}>
        <Notice tone="neutral" icon="i">
          <strong>None of this predicts anything.</strong> Each drawing is independent, so a number
          drawn 40 times is exactly as likely to come up next as one drawn 20 times. This page tells
          you what <em>happened</em> — useful for understanding the game, useless for guessing it.
        </Notice>
      </div>

      {s?.era.excludedDraws ? (
        <div style={{ marginBottom: 14 }}>
          <Fold tone="warn" summary={<><Term id="matrixEra">Some older drawings are excluded</Term> — here's why</>}>
            <p style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 10 }}>{s.era.note}</p>
          </Fold>
        </div>
      ) : null}

      <Tabs<Tab>
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'frequency', label: 'How often each number came up' },
          { id: 'patterns', label: 'Shapes & totals' },
          { id: 'positions', label: game.kind === 'digits' ? 'By position' : 'Pairs' },
          { id: 'audit', label: 'Is the game fair?' },
        ]}
      />

      {stats.isLoading && <Card><Skeleton rows={6} /></Card>}
      {s && s.drawCount === 0 && <EmptyState title="No drawings loaded">Sync this game on the Data tab first.</EmptyState>}

      {s && s.drawCount > 0 && (
        <>
          {/* ---------------- Frequency ---------------- */}
          {tab === 'frequency' && (
            <div className="grid" style={{ gap: 16 }}>
              <Card>
                <div className="card-head">
                  <div>
                    <h2>Every number, and how often it appeared</h2>
                    <p className="card-sub">
                      If the game is fair each number should land near{' '}
                      <strong>{s.numbers[0]?.expected.toFixed(0)}</strong> appearances. Bars are
                      highlighted when they sit unusually far from that.
                    </p>
                  </div>
                </div>

                <div style={{ height: 250 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={s.numbers} margin={{ top: 6, right: 6, left: -16, bottom: 0 }}>
                      <CartesianGrid stroke="var(--grid)" vertical={false} />
                      <XAxis dataKey="n" {...axis} interval="preserveStartEnd" />
                      <YAxis {...axis} />
                      <ReferenceLine
                        y={s.numbers[0]?.expected}
                        stroke="var(--muted-2)"
                        strokeDasharray="4 4"
                        label={{ value: 'expected', position: 'right', fill: 'var(--muted-2)', fontSize: 10 }}
                      />
                      <Tooltip
                        cursor={{ fill: 'var(--surface-3)' }}
                        contentStyle={tooltipStyle}
                        formatter={(v: number, _n, p) => {
                          const d = p.payload as { z: number; n: number };
                          return [`${v} times — ${readZ(d.z)}`, `Number ${d.n}`];
                        }}
                      />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {s.numbers.map((d) => (
                          <Cell key={d.n} fill={Math.abs(d.z) > 2 ? 'var(--series-4)' : 'var(--series-1)'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="legend">
                  <span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--series-1)' }} />Ordinary range</span>
                  <span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--series-4)' }} />Further from expected than usual</span>
                </div>

                {extreme && (
                  <div style={{ marginTop: 14 }}>
                    <Reading
                      tone={Math.abs(extreme.z) > 3 ? 'warn' : 'pos'}
                      plain={
                        <>The furthest from expectation is <strong>number {extreme.n}</strong>, appearing{' '}
                        {extreme.count} times when about {extreme.expected.toFixed(0)} was expected — {readZ(extreme.z)}.
                        With {s.numbers.length} numbers in play, a gap this size is exactly what chance produces.</>
                      }
                      technical={<>z = {extreme.z.toFixed(2)} · observed {extreme.count} · expected {extreme.expected.toFixed(1)}</>}
                    />
                  </div>
                )}
              </Card>

              <div className="grid grid-3">
                <Card title="Came up most" sub="Highest count in this period">
                  <NumberList items={s.hot} render={(x) => `${x.count}×`} />
                </Card>
                <Card title="Came up least" sub="Lowest count in this period">
                  <NumberList items={s.cold} render={(x) => `${x.count}×`} />
                </Card>
                <Card title="Longest absent" sub="Drawings since last seen">
                  <NumberList items={s.overdue} render={(x) => `${x.currentGap}`} />
                  <p className="inline-note" style={{ marginTop: 10 }}>
                    A long absence does <strong>not</strong> make a number <Term id="overdue">overdue</Term>.
                    Each drawing starts fresh.
                  </p>
                </Card>
              </div>
            </div>
          )}

          {/* ---------------- Patterns ---------------- */}
          {tab === 'patterns' && (
            <div className="grid grid-2">
              <Card title="Adding the numbers up" sub={`Most drawings total somewhere near ${s.sums.mean.toFixed(0)}. Extremes at either end are rare simply because there are fewer ways to make them.`}>
                <SimpleBars data={s.sums.histogram} />
                <p className="inline-note" style={{ marginTop: 10 }}>
                  Range seen: {s.sums.min} to {s.sums.max}. Typical spread: ±{s.sums.stdev.toFixed(0)}.
                </p>
              </Card>

              <Card title="Odd and even" sub="How many odd numbers turned up per drawing">
                <SimpleBars data={s.oddEven} />
                <p className="inline-note" style={{ marginTop: 10 }}>
                  An even split is the most common outcome — there are simply more ways to make it than an all-odd or all-even draw.
                </p>
              </Card>

              <Card title="High and low" sub="Numbers above versus below the middle of the range">
                <SimpleBars data={s.highLow} />
              </Card>

              {game.kind === 'combination' && (
                <>
                  <Card title="Numbers next to each other" sub="Like 14 and 15 appearing together">
                    <SimpleBars data={s.consecutive} />
                    <p className="inline-note" style={{ marginTop: 10 }}>
                      Consecutive numbers turn up far more than most people expect — avoiding them has no effect on your odds.
                    </p>
                  </Card>
                  <Card title="Carried over from the drawing before" sub="Numbers that repeated from the previous drawing">
                    <SimpleBars data={s.repeatsFromPrevious} />
                  </Card>
                </>
              )}
            </div>
          )}

          {/* ---------------- Positions / pairs ---------------- */}
          {tab === 'positions' && (
            <div className="grid" style={{ gap: 16 }}>
              {game.kind === 'digits' ? (
                s.positions.map((p) => (
                  <Card key={p.position} title={`Position ${p.position}`} sub="A fair machine spreads digits 0–9 evenly here.">
                    <SimpleBars data={p.counts} />
                  </Card>
                ))
              ) : s.topPairs.length > 0 ? (
                <Card
                  title="Numbers that showed up together most"
                  sub={`Any two numbers should appear together about ${s.topPairs[0]?.expected.toFixed(1)} times. Some pair always has to lead.`}
                >
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr><th>Pair</th><th className="t-right">Together</th><th className="t-right">Expected</th><th className="t-right">Difference</th></tr>
                      </thead>
                      <tbody>
                        {s.topPairs.slice(0, 12).map((p) => (
                          <tr key={`${p.a}-${p.b}`}>
                            <td><span className="row-tight"><Ball n={p.a} size="sm" /><Ball n={p.b} size="sm" /></span></td>
                            <td className="t-right num">{p.count}</td>
                            <td className="t-right num" style={{ color: 'var(--muted)' }}>{p.expected.toFixed(1)}</td>
                            <td className="t-right num">+{(p.count - p.expected).toFixed(1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <Reading
                      tone="pos"
                      plain={<>With {(((s.poolMax - s.poolMin + 1) * (s.poolMax - s.poolMin)) / 2).toLocaleString()} possible
                        pairs, one of them leading the table is arithmetic, not a signal. Betting on it would be betting on a coincidence.</>}
                    />
                  </div>
                </Card>
              ) : (
                <EmptyState title="Not applicable">This game draws a single number, so there are no pairs.</EmptyState>
              )}
            </div>
          )}

          {/* ---------------- Randomness audit ---------------- */}
          {tab === 'audit' && (
            <div className="grid" style={{ gap: 16 }}>
              {audit.isLoading && <Card><Skeleton rows={5} /></Card>}
              {audit.data && (
                <>
                  <div className="verdict">
                    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div className="verdict-title">
                          {audit.data.verdict === 'consistent_with_random' && 'The game looks completely fair'}
                          {audit.data.verdict === 'anomaly_detected' && 'Something looks unusual — read carefully'}
                          {audit.data.verdict === 'insufficient_data' && 'Not enough drawings yet to say'}
                        </div>
                        <p className="verdict-sub">{audit.data.summary}</p>
                      </div>
                      <Chip tone={audit.data.verdict === 'consistent_with_random' ? 'pos' : 'warn'}>
                        {audit.data.drawCount.toLocaleString()} drawings
                      </Chip>
                    </div>
                  </div>

                  <Card title="What we checked" sub="Each test looks for a different way a game could be rigged or broken.">
                    {audit.data.tests.map((t) => {
                      const reading = readPValue(t.pValue);
                      return (
                        <Reading
                          key={t.name}
                          tone={t.significant ? 'warn' : 'pos'}
                          plain={<><strong>{t.name}</strong> — {reading.plain.toLowerCase()}. {t.interpretation}</>}
                          technical={<>p = {t.pValue.toFixed(4)}{t.df !== undefined ? ` · df ${t.df}` : ''} · statistic {t.statistic.toFixed(3)} — {t.detail}</>}
                        />
                      );
                    })}
                    <p className="inline-note" style={{ marginTop: 12 }}>
                      A <Term id="pValue">p-value</Term> above 0.05 means the result is well within what
                      luck produces. Read the technical line under each result for the raw figures.
                    </p>
                  </Card>

                  <Notice tone="neutral" icon="i">
                    <strong>This is the one place history genuinely tells you something.</strong> These
                    tests check whether the <em>machine</em> is fair — not which numbers come next.
                    When they pass, as they consistently do, that is the strongest evidence available
                    that hot and cold streaks are just noise.
                  </Notice>

                  <p className="inline-note">{audit.data.eraNote}</p>
                </>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}

function NumberList({ items, render }: {
  items: Array<{ n: number; count: number; currentGap: number; z: number }>;
  render: (x: { n: number; count: number; currentGap: number }) => string;
}) {
  return (
    <div style={{ display: 'grid', gap: 7 }}>
      {items.slice(0, 8).map((x) => (
        <div key={x.n} className="row" style={{ justifyContent: 'space-between' }}>
          <Ball n={x.n} size="sm" />
          <span className="num" style={{ fontSize: 12.5, color: 'var(--muted)' }}>{render(x)}</span>
        </div>
      ))}
    </div>
  );
}

function SimpleBars({ data }: { data: Array<{ label: string; count: number }> }) {
  return (
    <div style={{ height: 185 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="label" {...axis} interval="preserveStartEnd" />
          <YAxis {...axis} />
          <Tooltip cursor={{ fill: 'var(--surface-3)' }} contentStyle={tooltipStyle} />
          <Bar dataKey="count" fill="var(--series-1)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
