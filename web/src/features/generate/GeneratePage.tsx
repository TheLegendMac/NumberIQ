import { useState, useEffect, useRef, Fragment } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GameId, StrategyDefinition, PrizeTier } from '@numberiq/shared';
import { nextDrawingForSlot, formatCountdown, describeSchedule, primaryDrawSlot, howToPlay } from '@numberiq/shared';
import { api, dateLabel, money, oneIn, slotLabel, type GameSummary, type GenerateResponse } from '../../lib/api.js';
import { latestDataDate } from '../../lib/gameData.js';
import { Button, Card, Chip, Field, Input, Notice, Select, Ball, Meter, ErrorBox, Fold } from '../../components/ui.js';
import { Term } from '../../components/Term.js';

interface Props {
  games: GameSummary[];
  gameId: GameId;
  setGameId: (id: GameId) => void;
}

/** The win amount for a prize tier, kept honest: '~' marks a historical average. */
function prizeText(t: PrizeTier): string {
  if (t.prizeLabel) return t.prizeLabel;
  if (t.prize !== null) return `${t.estimated ? '~' : ''}${money(t.prize)}`;
  return t.isJackpot ? 'Jackpot' : 'Pari-mutuel';
}

/** The tier a player is most likely to actually hit — smallest 1-in-N. */
function easiestTier(g: GameSummary): PrizeTier {
  return g.prizeTiers.reduce((a, b) => (b.oneIn < a.oneIn ? b : a), g.prizeTiers[0]!);
}

/**
 * How to play, your real chance to win anything, and the amount for every prize.
 * Computed straight from the game matrix so it can never drift from the odds.
 */
function PrizeBreakdown({ game }: { game: GameSummary }) {
  const tiers = game.prizeTiers;
  const easiest = easiestTier(game);
  const hasEstimate = tiers.some((t) => t.estimated && t.prize !== null);
  const returnRate = game.expectedValue === null ? null : game.expectedValue / game.basePrice;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <span className="stat-label">How to play</span>
        <p style={{ fontSize: 13.5, color: 'var(--text-dim)', margin: '5px 0 0' }}>{howToPlay(game)}</p>
        <p className="inline-note" style={{ marginTop: 4 }}>Drawn {describeSchedule(game.id)}</p>
      </div>

      <div className="stat" style={{ background: 'var(--pos-soft)', borderRadius: 12, padding: '12px 14px' }}>
        <span className="stat-label">Best chance to win anything</span>
        <span className="stat-value" style={{ fontSize: 24 }}>{oneIn(game.overallOneIn)}</span>
        <span className="inline-note" style={{ marginTop: 2 }}>
          Most reachable prize: {easiest.label} — {prizeText(easiest)} at {oneIn(easiest.oneIn)}
        </span>
      </div>

      <div className="grid grid-2" style={{ gap: 14 }}>
        <div className="stat">
          <span className="stat-label">Top prize odds</span>
          <span className="stat-value" style={{ fontSize: 18 }}>{oneIn(game.topPrizeOneIn)}</span>
        </div>
        <div className="stat">
          <span className="stat-label"><Term id="expectedValue">Long-run return</Term></span>
          <span className="stat-value neg" style={{ fontSize: 18 }}>
            {returnRate !== null ? `${(returnRate * 100).toFixed(0)}¢ per $1` : 'Below cost'}
          </span>
        </div>
      </div>

      <div>
        <span className="stat-label">How to win &amp; prize amounts</span>
        <div className="table-scroll" style={{ marginTop: 6 }}>
          <table>
            <thead>
              <tr><th>Match</th><th className="t-right">Odds</th><th className="t-right">Prize</th></tr>
            </thead>
            <tbody>
              {tiers.map((t, i) => (
                <tr key={i} style={t === easiest ? { background: 'var(--pos-soft)' } : undefined}>
                  <td>
                    {t.label}{' '}
                    {t.isJackpot ? <Chip tone="accent">Top prize</Chip>
                      : t === easiest ? <Chip tone="pos">Easiest</Chip> : null}
                  </td>
                  <td className="t-right num">{oneIn(t.oneIn)}</td>
                  <td className="t-right num">{prizeText(t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {hasEstimate && (
          <p className="inline-note" style={{ marginTop: 6 }}>
            ~ marks a historical average, not a posted amount — pari-mutuel tiers vary by draw.
          </p>
        )}
      </div>

      {game.notes && <p className="inline-note">{game.notes}</p>}
    </div>
  );
}

type Step = 'game' | 'approach' | 'review' | 'result';
const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'game', label: 'Game' },
  { id: 'approach', label: 'How to pick' },
  { id: 'review', label: 'Review' },
  { id: 'result', label: 'Numbers' },
];

export function GeneratePage({ games, gameId, setGameId }: Props) {
  const game = games.find((g) => g.id === gameId)!;
  const qc = useQueryClient();

  const [step, setStep] = useState<Step>('game');
  const [slot, setSlot] = useState(primaryDrawSlot(game));
  const [strategy, setStrategy] = useState('balanced');
  const [count, setCount] = useState(5);
  const [advanced, setAdvanced] = useState(false);
  const [exclude, setExclude] = useState('');
  const [require, setRequire] = useState('');
  const [batchMode, setBatchMode] = useState<'independent' | 'low_overlap' | 'coverage'>('low_overlap');
  const [toast, setToast] = useState<string | null>(null);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Re-render every so often so the countdown stays truthful.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const strategies = useQuery({ queryKey: ['strategies', gameId], queryFn: () => api.strategies(gameId) });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });

  const currentSlot = game.slots.includes(slot) ? slot : primaryDrawSlot(game);
  const dataThrough = latestDataDate(game.data, currentSlot);
  const activeStrategy: StrategyDefinition | undefined =
    strategies.data?.find((s) => s.id === strategy) ?? strategies.data?.[0];
  const generationKey = JSON.stringify([
    gameId, currentSlot, activeStrategy?.id ?? 'balanced', count, exclude, require, batchMode,
  ]);

  const generate = useMutation({
    mutationFn: ({ body }: { key: string; body: Record<string, unknown> }) => {
      navigator.vibrate?.(12);
      return api.generate(body);
    },
    onSuccess: (_result, variables) => { setGeneratedKey(variables.key); setStep('result'); },
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
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 3200);
    },
  });

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const beginGenerate = () => {
    save.reset();
    setToast(null);
    generate.mutate({
      key: generationKey,
      body: {
        gameId, strategy: activeStrategy?.id ?? 'balanced', slot: currentSlot, count,
        exclude: parseNumbers(exclude), require: parseNumbers(require),
        batchMode, avoidTrivialPatterns: true,
      },
    });
  };

  const selectGame = (id: GameId) => {
    if (id !== gameId) {
      setGameId(id);
      setSlot(primaryDrawSlot(games.find((x) => x.id === id)!));
      setStrategy('balanced');
      setGeneratedKey(null);
    }
    setStep('approach');
  };

  const selectApproach = (id: string) => { setStrategy(id); setStep('review'); };

  const upcoming = nextDrawingForSlot(gameId, currentSlot);
  const isFixed = game.payoutModel === 'fixed';
  const budget = settings.data?.budget;
  const result = generatedKey === generationKey ? generate.data : undefined;
  const hero = result?.tickets[0];
  const rest = result?.tickets.slice(1) ?? [];

  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const goStep = (target: Step) => {
    const ti = STEPS.findIndex((s) => s.id === target);
    if (target === 'result' && !result) return;
    if (ti <= stepIndex) setStep(target);
  };

  const rankedGames = [...games].sort((a, b) => a.overallOneIn - b.overallOneIn);

  return (
    <>
      <header className="page-head" style={{ marginBottom: 4 }}>
        <h1>Generate numbers</h1>
        <p>Four quick steps — starting with the games you’re most likely to win something on.</p>
      </header>

      {/* --- Step indicator, doubles as back-navigation --- */}
      <div className="stepper">
        {STEPS.map((s, i) => {
          const state = i < stepIndex ? 'done' : i === stepIndex ? 'on' : 'pending';
          const canClick = i <= stepIndex && (s.id !== 'result' || !!result);
          return (
            <Fragment key={s.id}>
              {i > 0 && <span className="step-sep" aria-hidden="true">›</span>}
              <button
                type="button"
                className={`step-pill ${state === 'on' ? 'on' : state === 'done' ? 'done' : ''} ${canClick && state !== 'on' ? 'clickable' : ''}`}
                onClick={() => canClick && goStep(s.id)}
                disabled={!canClick}
                aria-current={state === 'on' ? 'step' : undefined}
              >
                <span className="step-pill-num" aria-hidden="true">{state === 'done' ? '✓' : i + 1}</span>
                {s.label}
              </button>
            </Fragment>
          );
        })}
      </div>

      {budget?.exceeded && (
        <div style={{ marginBottom: 14 }}>
          <Notice>
            <strong>You've reached the budget you set.</strong> Generating is paused until the next
            period. You can adjust it on the Tickets page.
          </Notice>
        </div>
      )}

      {strategies.isError && <div style={{ marginBottom: 14 }}><ErrorBox error={strategies.error} /></div>}
      {settings.isError && <div style={{ marginBottom: 14 }}><ErrorBox error={settings.error} /></div>}
      {generate.isError && <div style={{ marginBottom: 14 }}><ErrorBox error={generate.error} /></div>}
      {save.isError && <div style={{ marginBottom: 14 }}><ErrorBox error={save.error} /></div>}

      {/* --- STEP 1: pick a game, ranked by chance to win anything --- */}
      {step === 'game' && (
        <Card
          title="Which game?"
          sub="Ranked by your chance to win anything — best at the top."
        >
          <Notice tone="neutral" icon="i">
            <strong>Easier to win ≠ a bigger prize or better value.</strong> Powerball and Mega Millions
            sit high here because you often win just a few dollars back. The prize each row is most
            likely to pay is shown so you can weigh “often” against “worth it.”
          </Notice>

          <div className="choice-grid" style={{ marginTop: 14 }}>
            {rankedGames.map((g, i) => {
              const easiest = easiestTier(g);
              return (
                <button
                  key={g.id}
                  type="button"
                  className={`choice ${g.id === gameId ? 'choice-on' : ''}`}
                  onClick={() => selectGame(g.id)}
                >
                  <span className="choice-rank">{i + 1}</span>
                  <span className="choice-body">
                    <span className="choice-title">{g.name}</span>
                    <span className="choice-sub">
                      {money(g.basePrice)} per play · most wins pay {prizeText(easiest)}
                    </span>
                  </span>
                  <span className="choice-side">
                    <span className="choice-odds">{oneIn(g.overallOneIn)}</span>
                    <span className="choice-odds-label">win anything</span>
                  </span>
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {/* --- STEP 2: how to pick the numbers --- */}
      {step === 'approach' && (
        <Card
          title="How should we pick your numbers?"
          sub={`For ${game.name}. Every option has identical odds — they only change which numbers you get.`}
          actions={<Button size="sm" variant="ghost" onClick={() => setStep('game')}>← Game</Button>}
        >
          {strategies.isLoading && <p className="inline-note">Loading approaches…</p>}
          <div className="choice-grid">
            {strategies.data?.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`choice ${activeStrategy?.id === s.id ? 'choice-on' : ''}`}
                onClick={() => selectApproach(s.id)}
              >
                <span className="choice-body">
                  <span className="choice-title">
                    {s.name}
                    {s.id === 'balanced' && <> <Chip tone="pos">Recommended</Chip></>}
                  </span>
                  <span className="choice-sub">{s.description}</span>
                </span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* --- STEP 3: how many, and confirm --- */}
      {step === 'review' && (
        <Card
          title="How many, and a final look"
          actions={<Button size="sm" variant="ghost" onClick={() => setStep('approach')}>← How to pick</Button>}
        >
          <div className="row-tight" style={{ marginBottom: 14 }}>
            <Chip tone="accent">{game.name}</Chip>
            {game.slots.length > 1 && <Chip>{slotLabel(game, currentSlot)}</Chip>}
            <Chip>{activeStrategy?.name}</Chip>
            {dataThrough && <Chip>Data through {dateLabel(dataThrough)}</Chip>}
          </div>

          {upcoming && (
            <div className="next-draw" title={describeSchedule(gameId)} style={{ marginBottom: 14 }}>
              <span className="next-draw-dot" aria-hidden="true" />
              Next drawing {formatCountdown(upcoming.msUntil)}
              <span className="next-draw-time">{upcoming.timeLabel}</span>
            </div>
          )}

          <div className="grid grid-2" style={{ gap: 12 }}>
            {game.slots.length > 1 && (
              <Field label="Drawing">
                <Select value={currentSlot} onChange={(e) => setSlot(e.target.value)}>
                  {game.slots.map((s) => <option key={s} value={s}>{slotLabel(game, s)}</option>)}
                </Select>
              </Field>
            )}
            <Field label="How many tickets" hint={`${money(game.basePrice)} each · ${money(game.basePrice * count)} total`}>
              <Input
                type="number" min={1} max={50} value={count}
                onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
              />
            </Field>
          </div>

          <div style={{ marginTop: 12 }}>
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

          <div className="hero-actions" style={{ marginTop: 18, justifyContent: 'flex-start' }}>
            <Button variant="primary" size="lg" onClick={beginGenerate} disabled={generate.isPending || budget?.exceeded}>
              {generate.isPending ? 'Generating…' : `Generate ${count > 1 ? `${count} tickets` : 'ticket'}`}
            </Button>
          </div>

          <div style={{ marginTop: 18 }}>
            <Fold defaultOpen summary={<>How to play, your odds &amp; every prize</>}>
              <div style={{ marginTop: 12 }}><PrizeBreakdown game={game} /></div>
            </Fold>
          </div>
        </Card>
      )}

      {/* --- STEP 4: the numbers --- */}
      {step === 'result' && hero && result && (
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
              <Button variant="primary" size="lg" onClick={beginGenerate} disabled={generate.isPending || budget?.exceeded}>
                {generate.isPending ? 'Generating…' : 'Generate again'}
              </Button>
              <Button size="lg" onClick={() => save.mutate(result)} disabled={save.isPending || save.isSuccess}>
                {save.isPending
                  ? 'Saving…'
                  : save.isSuccess
                    ? 'Saved'
                    : `Save ${result.tickets.length > 1 ? `all ${result.tickets.length}` : 'ticket'}`}
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
              <Fold summary={<>How your numbers affect what you'd win</>}>
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

            <Fold summary={<>How to play, your odds &amp; every prize</>}>
              <div style={{ marginTop: 12 }}><PrizeBreakdown game={game} /></div>
            </Fold>
          </div>

          {result.warnings.map((w, i) => (
            <div key={i} style={{ marginTop: 12 }}><Notice>{w}</Notice></div>
          ))}
        </>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}

function parseNumbers(s: string): number[] {
  return (s.match(/\d+/g) ?? []).map(Number);
}
