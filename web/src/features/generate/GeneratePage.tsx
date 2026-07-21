import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GameId, StrategyDefinition } from '@numberiq/shared';
import { nextDrawingForSlot, formatCountdown, describeSchedule } from '@numberiq/shared';
import { api, money, oneIn, slotLabel, type GameSummary, type GenerateResponse } from '../../lib/api.js';
import { Button, Card, Chip, Field, Input, Notice, Select, Ball, Meter, ErrorBox, Fold } from '../../components/ui.js';
import { Term } from '../../components/Term.js';

interface Props {
  games: GameSummary[];
  gameId: GameId;
  setGameId: (id: GameId) => void;
}

export function GeneratePage({ games, gameId, setGameId }: Props) {
  const game = games.find((g) => g.id === gameId)!;
  const qc = useQueryClient();

  const [slot, setSlot] = useState(game.slots[game.slots.length - 1]!);
  const [strategy, setStrategy] = useState('balanced');
  const [count, setCount] = useState(5);
  const [showControls, setShowControls] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [exclude, setExclude] = useState('');
  const [require, setRequire] = useState('');
  const [batchMode, setBatchMode] = useState<'independent' | 'low_overlap' | 'coverage'>('low_overlap');
  const [toast, setToast] = useState<string | null>(null);
  // Re-render once a minute so the countdown stays truthful.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const strategies = useQuery({ queryKey: ['strategies', gameId], queryFn: () => api.strategies(gameId) });
  const odds = useQuery({ queryKey: ['odds', gameId], queryFn: () => api.odds(gameId) });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });

  const currentSlot = game.slots.includes(slot) ? slot : game.slots[game.slots.length - 1]!;
  const activeStrategy: StrategyDefinition | undefined =
    strategies.data?.find((s) => s.id === strategy) ?? strategies.data?.[0];

  const generate = useMutation({
    mutationFn: () => {
      // Light haptic on supported devices — confirms the tap without a sound.
      navigator.vibrate?.(12);
      return api.generate({
        gameId, strategy: activeStrategy?.id ?? 'balanced', slot: currentSlot, count,
        exclude: parseNumbers(exclude), require: parseNumbers(require),
        batchMode, avoidTrivialPatterns: true,
      });
    },
  });

  const save = useMutation({
    mutationFn: (result: GenerateResponse) =>
      api.saveTickets(
        result.tickets.map((t) => ({
          gameId, numbers: t.numbers, extras: t.extras,
          strategy: activeStrategy?.id ?? 'balanced',
          score: t.score.total, cost: result.costPerTicket,
          drawSlot: result.slot,
          // Without a target drawing the tracker can never check the ticket, so
          // it would sit "Pending" forever and ROI would never populate.
          targetDrawDate: upcoming?.drawDate ?? null,
        })),
      ),
    onSuccess: (r) => {
      setToast(
        upcoming
          ? `Saved ${r.saved} ticket${r.saved === 1 ? '' : 's'} for the ${upcoming.timeLabel} drawing.`
          : `Saved ${r.saved} ticket${r.saved === 1 ? '' : 's'} to your tracker.`,
      );
      void qc.invalidateQueries({ queryKey: ['tracker'] });
      void qc.invalidateQueries({ queryKey: ['tickets'] });
      setTimeout(() => setToast(null), 3200);
    },
  });

  const upcoming = nextDrawingForSlot(gameId, currentSlot);
  const isFixed = game.payoutModel === 'fixed';
  const budget = settings.data?.budget;
  const result = generate.data;
  const hero = result?.tickets[0];
  const rest = result?.tickets.slice(1) ?? [];

  return (
    <>
      {/* --- Compact context bar: what you're playing, one tap to change --- */}
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {game.name}
            {game.slots.length > 1 && (
              <span style={{ color: 'var(--muted)', fontWeight: 500, fontSize: 15 }}>
                · {slotLabel(game, currentSlot)}
              </span>
            )}
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
            {activeStrategy?.name ?? 'Balanced'} · {money(game.basePrice)} per ticket
          </p>
          {upcoming && (
            <div className="next-draw" title={describeSchedule(gameId)}>
              <span className="next-draw-dot" aria-hidden="true" />
              Next drawing {formatCountdown(upcoming.msUntil)}
              <span className="next-draw-time">{upcoming.timeLabel}</span>
            </div>
          )}
        </div>
        <Button onClick={() => setShowControls(!showControls)} aria-expanded={showControls}>
          {showControls ? 'Done' : 'Change'}
        </Button>
      </div>

      {/* --- Controls: hidden until asked for --- */}
      {showControls && (
        <Card className="mb" >
          <div className="grid grid-4" style={{ gap: 12 }}>
            <Field label="Game">
              <Select
                value={gameId}
                onChange={(e) => {
                  const next = e.target.value as GameId;
                  setGameId(next);
                  setSlot(games.find((x) => x.id === next)!.slots.slice(-1)[0]!);
                }}
              >
                {games.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </Select>
            </Field>

            {game.slots.length > 1 && (
              <Field label="Drawing">
                <Select value={currentSlot} onChange={(e) => setSlot(e.target.value)}>
                  {game.slots.map((s) => <option key={s} value={s}>{slotLabel(game, s)}</option>)}
                </Select>
              </Field>
            )}

            <Field label="Approach">
              <Select value={activeStrategy?.id ?? ''} onChange={(e) => setStrategy(e.target.value)}>
                {strategies.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>

            <Field label="Tickets">
              <Input
                type="number" min={1} max={50} value={count}
                onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
              />
            </Field>
          </div>

          {activeStrategy && (
            <p className="inline-note" style={{ marginTop: 12 }}>{activeStrategy.description}</p>
          )}

          <div style={{ marginTop: 14 }}>
            <Button size="sm" variant="ghost" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>
              {advanced ? '− Fewer options' : '+ More options'}
            </Button>
          </div>

          {advanced && (
            <div className="grid grid-3" style={{ marginTop: 12 }}>
              <Field label="Never use these" hint="Comma separated, e.g. 4, 13, 22">
                <Input value={exclude} onChange={(e) => setExclude(e.target.value)} placeholder="none" />
              </Field>
              <Field label="Always include these" hint="Appear on every ticket">
                <Input value={require} onChange={(e) => setRequire(e.target.value)} placeholder="none" />
              </Field>
              <Field label="How tickets relate" hint="Spreading out catches more small prizes">
                <Select value={batchMode} onChange={(e) => setBatchMode(e.target.value as typeof batchMode)}>
                  <option value="low_overlap">Spread out — share few numbers</option>
                  <option value="coverage">Maximum spread — cover the most numbers</option>
                  <option value="independent">Independent — each drawn separately</option>
                </Select>
              </Field>
            </div>
          )}
        </Card>
      )}

      {/* --- Budget block is the one thing that must interrupt --- */}
      {budget?.exceeded && (
        <div style={{ marginBottom: 14 }}>
          <Notice>
            <strong>You've reached the budget you set.</strong> Generating is paused until the next
            period. You can adjust it on the Tickets page.
          </Notice>
        </div>
      )}

      {generate.isError && <div style={{ marginBottom: 14 }}><ErrorBox error={generate.error} /></div>}

      {/* --- THE HERO: the thing you came for --- */}
      {hero && result && (
        <>
          <div className="hero" aria-live="polite">
            <div className="hero-eyebrow">
              <span>{game.name}</span>
              {game.slots.length > 1 && <span>·</span>}
              {game.slots.length > 1 && <span>{slotLabel(game, result.slot)}</span>}
            </div>

            <div className="hero-balls">
              {hero.numbers.map((n, i) => (
                <Ball key={i} n={n} kind={game.kind === 'digits' ? 'digit' : 'main'} />
              ))}
              {game.extraBall && hero.extras[game.extraBall.key] !== undefined && (
                <Ball n={hero.extras[game.extraBall.key]!} kind="extra" title={game.extraBall.label} />
              )}
            </div>

            <div className="hero-meta">
              <Chip tone="accent">{activeStrategy?.name}</Chip>
              <Chip>
                <Term id="strategyScore">Score</Term>
                <strong className="hero-score-value" style={{ marginLeft: 2 }}>{hero.score.total}</strong>
              </Chip>
            </div>

            <p className="hero-explain">{hero.score.explanation}</p>

            <div className="hero-actions">
              <Button variant="primary" size="lg" onClick={() => generate.mutate()} disabled={generate.isPending || budget?.exceeded}>
                {generate.isPending ? 'Generating…' : 'Generate again'}
              </Button>
              <Button size="lg" onClick={() => save.mutate(result)} disabled={save.isPending}>
                {save.isPending ? 'Saving…' : `Save ${result.tickets.length > 1 ? `all ${result.tickets.length}` : 'ticket'}`}
              </Button>
            </div>
          </div>

          {/* --- Everything else, folded --- */}
          <div className="grid" style={{ gap: 10, marginTop: 14 }}>
            {rest.length > 0 && (
              <Fold summary={<><strong style={{ color: 'var(--text)' }}>{rest.length} more ticket{rest.length === 1 ? '' : 's'}</strong> · {money(result.totalCost)} total</>}>
                {rest.map((t, i) => (
                  <div className="ticket" key={i} style={{ marginTop: i === 0 ? 12 : undefined }}>
                    <div className="row-tight" style={{ flex: 1, minWidth: 180 }}>
                      {t.numbers.map((n, j) => (
                        <Ball key={j} n={n} size="sm" kind={game.kind === 'digits' ? 'digit' : 'main'} />
                      ))}
                      {game.extraBall && t.extras[game.extraBall.key] !== undefined && (
                        <Ball n={t.extras[game.extraBall.key]!} size="sm" kind="extra" />
                      )}
                    </div>
                    <div className="score">
                      <span className="score-value">{t.score.total}</span>
                      <span className="score-label">Score</span>
                    </div>
                  </div>
                ))}
                <p className="inline-note" style={{ marginTop: 10 }}>
                  These tickets <Term id="overlap">share {result.batch.averageOverlap.toFixed(1)} numbers</Term>{' '}
                  on average and cover {Math.round(result.batch.poolCoverage * 100)}% of the number pool.
                </p>
              </Fold>
            )}

            <Fold summary={<>Why this ticket scored <strong style={{ color: 'var(--text)' }}>{hero.score.total}</strong></>}>
              <div style={{ display: 'grid', gap: 13, marginTop: 12 }}>
                {hero.score.components.map((c) => (
                  <div key={c.key}>
                    <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 550 }}>
                        {c.label}
                        <span className="inline-note"> · counts for {Math.round(c.weight * 100)}%</span>
                      </span>
                      <span className="num" style={{ fontSize: 12.5, color: 'var(--muted)' }}>{Math.round(c.value)}/100</span>
                    </div>
                    <Meter value={c.value} />
                    <p className="inline-note" style={{ marginTop: 4 }}>{c.detail}</p>
                  </div>
                ))}
                <p className="inline-note">
                  This score describes how the ticket is <em>built</em>, not your chance of winning.
                  Every combination in {game.name} has identical odds.
                </p>
              </div>
            </Fold>

            {/* Required disclosure — permanently present, never dismissible, but folded. */}
            {isFixed ? (
              <Fold
                tone="warn"
                summary={<>Your numbers <strong style={{ color: 'var(--text)' }}>cannot</strong> change what you win in {game.name}</>}
              >
                <p style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 10 }}>
                  {game.name} is a <Term id="fixedPayout">fixed payout</Term> game. Every combination
                  has identical odds and wins an identical, posted prize — and prizes are never split
                  between winners. No selection method, this one included, can improve your expected
                  return. These numbers are a convenience, nothing more.
                </p>
              </Fold>
            ) : (
              <Fold
                summary={<>How your numbers affect what you'd win</>}
              >
                <p style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 10 }}>
                  {game.name} is a{' '}
                  <Term id={game.payoutModel === 'parimutuel' ? 'pariMutuel' : 'splitJackpot'}>
                    {game.payoutModel === 'parimutuel' ? 'pari-mutuel' : 'split jackpot'}
                  </Term>{' '}
                  game, so prizes are shared among the people who win them. Picking numbers others
                  avoid does <strong>not</strong> improve your odds of winning — nothing can — but it
                  means fewer people to split with if you do.
                </p>
                {activeStrategy?.class === 'cosmetic' && (
                  <p style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 10 }}>
                    <strong>{activeStrategy.name}</strong> is different: {activeStrategy.disclosure}
                  </p>
                )}
              </Fold>
            )}

            <Fold summary={<>Your real odds and what a ticket returns</>}>
              {odds.data && (
                <div className="grid grid-3" style={{ marginTop: 12, gap: 14 }}>
                  <div className="stat">
                    <span className="stat-label">Top prize</span>
                    <span className="stat-value" style={{ fontSize: 18 }}>{oneIn(odds.data.officialOdds.topPrize)}</span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Any prize</span>
                    <span className="stat-value" style={{ fontSize: 18 }}>{oneIn(odds.data.officialOdds.overall)}</span>
                  </div>
                  <div className="stat">
                    <span className="stat-label"><Term id="expectedValue">Long-run return</Term></span>
                    <span className="stat-value neg" style={{ fontSize: 18 }}>
                      {odds.data.returnRate !== null ? `${(odds.data.returnRate * 100).toFixed(0)}¢ per $1` : 'Below cost'}
                    </span>
                  </div>
                  <p className="inline-note" style={{ gridColumn: '1 / -1' }}>{odds.data.disclosure}</p>
                </div>
              )}
            </Fold>
          </div>
        </>
      )}

      {/* --- First run --- */}
      {!hero && (
        <div className="hero">
          <div className="hero-eyebrow"><span>{game.name}</span></div>
          <div className="hero-balls" aria-hidden="true">
            {Array.from({ length: Math.min(game.pick, 6) }, (_, i) => (
              <span key={i} className="ball" style={{ opacity: 0.28 }}>?</span>
            ))}
          </div>
          <p className="hero-explain" style={{ marginTop: 18 }}>
            {game.data.length > 0
              ? `${game.data.reduce((s, d) => s + d.count, 0).toLocaleString()} official drawings loaded. Press generate when you're ready.`
              : 'No history loaded yet — visit the Data tab to sync official results.'}
          </p>
          <div className="hero-actions">
            <Button variant="primary" size="lg" onClick={() => generate.mutate()} disabled={generate.isPending || budget?.exceeded}>
              {generate.isPending ? 'Generating…' : 'Generate numbers'}
            </Button>
          </div>
        </div>
      )}

      {result?.warnings.map((w, i) => (
        <div key={i} style={{ marginTop: 12 }}><Notice>{w}</Notice></div>
      ))}

      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}

function parseNumbers(s: string): number[] {
  return s.split(/[^0-9]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0);
}
