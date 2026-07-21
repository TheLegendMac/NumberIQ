import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { nextDrawing, formatCountdown, floridaDate } from '@numberiq/shared';
import type { Draw, GameId } from '@numberiq/shared';
import { api, money, pct, dateLabel, slotLabel, type GameSummary } from '../../lib/api.js';
import { latestDataDate, latestResultSlot } from '../../lib/gameData.js';

/** A saved ticket as `/tickets` returns it — with its result already attached. */
type HeldTicket = Awaited<ReturnType<typeof api.tickets>>[number];
import { Card, Chip, Stat, Skeleton, EmptyState, Ball, Fold, Button, Meter, ErrorBox } from '../../components/ui.js';
import { Reading } from '../../components/Term.js';

interface Props { games: GameSummary[]; go: (route: string) => void }

const LAST_VISIT_KEY = 'numberiq-last-visit';

/**
 * The visit before this one, read once on mount and then advanced.
 *
 * Captured in a ref rather than state because the value must survive the render
 * that writes the new timestamp — and must not be re-read under StrictMode's
 * double-invoke, which would otherwise collapse "since you last looked" to
 * "since a millisecond ago".
 */
function usePreviousVisit(): string | null {
  const previous = useRef<string | null | undefined>(undefined);
  if (previous.current === undefined) {
    try { previous.current = localStorage.getItem(LAST_VISIT_KEY); }
    catch { previous.current = null; }
  }
  useEffect(() => {
    try { localStorage.setItem(LAST_VISIT_KEY, new Date().toISOString()); }
    catch { /* storage can be unavailable */ }
  }, []);
  return previous.current;
}

export function TodayPage({ games, go }: Props) {
  const previousVisit = usePreviousVisit();
  const [, setTick] = useState(0);

  // Countdowns go stale silently otherwise.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const tracker = useQuery({ queryKey: ['tracker'], queryFn: api.tracker });
  const tickets = useQuery({ queryKey: ['tickets'], queryFn: api.tickets });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });

  const t = tracker.data;
  const budget = settings.data?.budget;
  const held = tickets.data ?? [];

  // Only the slots the user actually has money on — usually one or two.
  const watched = [...new Map(held.map((x) => [`${x.gameId}:${x.drawSlot}`, x])).values()]
    .map((x) => ({ gameId: x.gameId, slot: x.drawSlot }));

  const results = useQuery({
    queryKey: ['today-results', watched.map((w) => `${w.gameId}:${w.slot}`).sort().join(',')],
    enabled: watched.length > 0,
    queryFn: async () => {
      const draws = await Promise.all(
        watched.map(async (w) => ({ ...w, draw: (await api.recent(w.gameId, w.slot, 1))[0] ?? null })),
      );
      return draws.filter((d): d is typeof d & { draw: Draw } => d.draw !== null);
    },
  });

  // A drawing counts as new when it landed on or after the day of the previous
  // visit — compared in Florida terms, because that is what `drawDate` means.
  const previousVisitDate = previousVisit ? floridaDate(new Date(previousVisit)) : null;
  const resolved = (results.data ?? [])
    .map((r) => {
      const game = games.find((g) => g.id === r.gameId);
      // Generation hands back a batch, so a single drawing routinely has several
      // tickets against it. Picking one would silently hide the rest.
      const mine = held.filter(
        (x) => x.gameId === r.gameId && x.drawSlot === r.slot && x.targetDrawDate === r.draw.drawDate,
      );
      const isNew = previousVisitDate === null || r.draw.drawDate >= previousVisitDate;
      return { ...r, game, mine, isNew };
    })
    .sort((a, b) => b.draw.drawDate.localeCompare(a.draw.drawDate));

  const newCount = resolved.filter((r) => r.isNew).length;
  const pending = held.filter((x) => !x.result);
  const dataThrough = latestDataDate(games.flatMap((g) => g.data));

  // Next drawings, soonest first, with the games you hold tickets for called out.
  const upcoming = games
    .map((g) => ({ game: g, next: nextDrawing(g.id), holding: pending.filter((p) => p.gameId === g.id).length }))
    .filter((x): x is typeof x & { next: NonNullable<ReturnType<typeof nextDrawing>> } => x.next !== null)
    .sort((a, b) => (b.holding - a.holding) || (a.next.msUntil - b.next.msUntil));

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  return (
    <>
      <header className="page-head">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h1>Today</h1>
          <span className="inline-note">{today}</span>
        </div>
        <p>Where you stand, what has drawn, and what is next. Everything else is a click away.</p>
      </header>

      {tracker.isError && <ErrorBox error={tracker.error} />}
      {tickets.isError && <ErrorBox error={tickets.error} />}
      {settings.isError && <ErrorBox error={settings.error} />}
      {results.isError && <ErrorBox error={results.error} />}

      {/* ---------------- Results ---------------- */}
      <Card
        title={newCount > 0 ? 'Since you last looked' : 'Latest results'}
        sub={
          held.length === 0
            ? undefined
            : 'The most recent drawing for every game you hold a ticket on.'
        }
        actions={(dataThrough || newCount > 0) ? (
          <div className="row-tight" style={{ justifyContent: 'flex-end' }}>
            {dataThrough && <Chip>Latest loaded draw {dateLabel(dataThrough)}</Chip>}
            {newCount > 0 && <Chip tone="accent">{newCount} new</Chip>}
          </div>
        ) : undefined}
      >
        {tickets.isLoading || results.isLoading ? (
          <Skeleton rows={3} />
        ) : held.length === 0 ? (
          <EmptyState
            title="No tickets saved yet"
            action={<Button variant="primary" onClick={() => go('generate')}>Generate numbers</Button>}
          >
            Once you save a ticket it is checked automatically as results land, and the outcome shows
            up here.
          </EmptyState>
        ) : resolved.length === 0 ? (
          <EmptyState title="No drawings recorded yet">
            Sync these games on the Data tab and results will appear here.
          </EmptyState>
        ) : (
          <div className="result-list">
            {resolved.map((r) => (
              <div className="result-row" key={`${r.gameId}:${r.slot}`}>
                <div className="result-row-head">
                  <span className="draw-row-game">{r.game?.name ?? r.gameId}</span>
                  <span className="inline-note">
                    {r.game && r.game.slots.length > 1 ? `${slotLabel(r.game, r.slot)} · ` : ''}
                    {dateLabel(r.draw.drawDate)}
                  </span>
                  {r.isNew && <Chip tone="accent">New</Chip>}
                </div>

                <div className="ticket-row-nums">
                  {r.draw.numbers.map((n, i) => (
                    <Ball key={i} n={n} kind={r.game?.kind === 'digits' ? 'digit' : 'main'} />
                  ))}
                  {r.game?.extraBall && r.draw.extras[r.game.extraBall.key] !== undefined && (
                    <Ball n={r.draw.extras[r.game.extraBall.key]!} kind="extra" />
                  )}
                </div>

                <div className="result-row-you">
                  <TicketOutcome tickets={r.mine} />
                </div>
              </div>
            ))}
          </div>
        )}

        <Fold summary="Latest numbers for every game">
          <AllGameResults games={games} />
        </Fold>
      </Card>

      {/* ---------------- Position ---------------- */}
      {t && (
        <div style={{ marginTop: 14 }}>
          <Card>
            <div className="grid grid-4">
              <Stat
                label="Net position" large
                value={money(t.net)}
                tone={t.net < 0 ? 'neg' : t.net > 0 ? 'pos' : undefined}
                hint={t.spend > 0 ? `${pct(t.roi)} return on ${money(t.spend)}` : 'Nothing spent yet'}
              />
              <Stat label="Spent" value={money(t.spend)} hint={`${t.ticketCount} tickets`} />
              <Stat label="Won" value={money(t.winnings)} hint={t.biggestWin ? `Best: ${money(t.biggestWin.amount)}` : 'No wins yet'} />
              <Stat
                label="Awaiting results" value={`${t.pendingCount}`}
                hint={t.pendingCount === 0 ? 'All results in' : 'tickets not yet drawn'}
              />
            </div>

            {t.spend > 0 && (
              <div style={{ marginTop: 14 }}>
                <Reading
                  tone={t.net < 0 ? 'warn' : 'pos'}
                  plain={t.net < 0
                    ? <>You are down <strong>{money(Math.abs(t.net))}</strong> overall. That is the
                      expected outcome — every game here pays back less than it costs.</>
                    : <>You are ahead by <strong>{money(t.net)}</strong> right now. Over a longer run this
                      trends negative; the games are built that way.</>}
                />
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ---------------- Next up ---------------- */}
      <div style={{ marginTop: 14 }}>
        <Card
          title="Next up"
          sub="Florida time. Games you hold tickets on come first."
          actions={<Button size="sm" variant="ghost" onClick={() => go('tickets')}>All schedules</Button>}
        >
          <div className="draw-list">
            {upcoming.slice(0, 5).map(({ game, next, holding }) => (
              <div className="draw-row" key={game.id}>
                <div className="draw-row-main">
                  <span className="draw-row-game">{game.name}</span>
                  <span className="inline-note">
                    {holding > 0
                      ? `${holding} ticket${holding === 1 ? '' : 's'} waiting`
                      : 'No ticket held'}
                  </span>
                </div>
                <div className="draw-row-when">
                  <span className="draw-row-count">{formatCountdown(next.msUntil)}</span>
                  <span className="inline-note">
                    {game.slots.length > 1 ? `${slotLabel(game, next.slot)} · ` : ''}{next.timeLabel}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* ---------------- Budget ---------------- */}
      {budget && (budget.weeklyBudget !== null || budget.monthlyBudget !== null) && (
        <div style={{ marginTop: 14 }}>
          <Card
            title="Budget"
            actions={<Button size="sm" variant="ghost" onClick={() => go('tickets')}>Edit</Button>}
          >
            <div style={{ display: 'grid', gap: 10 }}>
              {budget.weeklyBudget !== null && (
                <BudgetLine label="This week" spent={budget.spentThisWeek} limit={budget.weeklyBudget} />
              )}
              {budget.monthlyBudget !== null && (
                <BudgetLine label="This month" spent={budget.spentThisMonth} limit={budget.monthlyBudget} />
              )}
              {budget.exceeded && (
                <p className="inline-note" style={{ color: 'var(--neg)' }}>
                  You have reached your limit. Generation is paused until the next period.
                </p>
              )}
            </div>
          </Card>
        </div>
      )}

      <div className="row" style={{ marginTop: 18, gap: 10 }}>
        <Button variant="primary" onClick={() => go('generate')}>Generate numbers</Button>
        <Button variant="ghost" onClick={() => go('analyze')}>Look at the history</Button>
      </div>
    </>
  );
}

/**
 * What the tickets held against one drawing actually did.
 *
 * A zero payout is not the same as a loss. Tiers whose prize is null — jackpots
 * and pari-mutuel top tiers — evaluate to 0 because the amount is not knowable
 * from the matrix alone, so a top-tier hit arrives here indistinguishable from a
 * miss by payout. Reading the tier instead is the difference between "you won,
 * amount unknown" and "you lost".
 */
function TicketOutcome({ tickets }: { tickets: HeldTicket[] }) {
  if (tickets.length === 0) {
    return <span className="inline-note">You held no ticket for this drawing.</span>;
  }

  const checked = tickets.filter((t) => t.result !== null);
  const noun = tickets.length === 1 ? 'ticket' : `${tickets.length} tickets`;

  if (checked.length === 0) {
    return <Chip tone="warn">Your {noun} {tickets.length === 1 ? 'is' : 'are'} not checked yet</Chip>;
  }

  const won = checked.reduce((sum, t) => sum + t.result!.payout, 0);
  const unvalued = checked.filter((t) => t.result!.payout === 0 && t.result!.tier !== null);
  const best = Math.max(...checked.map((t) => t.result!.matches));

  if (unvalued.length > 0) {
    return (
      <span className="row-tight">
        <Chip tone="pos">Your {noun} hit {unvalued[0]!.result!.tier}</Chip>
        <span className="inline-note">
          Prize varies by drawing — check the official results for the amount.
        </span>
      </span>
    );
  }
  if (won > 0) return <Chip tone="pos">Your {noun} won {money(won)}</Chip>;

  return (
    <Chip>
      Your {noun}: best {best} matched · no prize
    </Chip>
  );
}

/**
 * Every game's most recent drawing. Mounted only when the fold opens — Fold does
 * not render its children while closed — so the home screen costs one request per
 * watched slot until the user asks for more.
 */
function AllGameResults({ games }: { games: GameSummary[] }) {
  const targets = games
    .map((g) => ({ game: g, slot: latestResultSlot(g) }))
    .filter((x): x is { game: GameSummary; slot: string } => x.slot !== null);

  const all = useQuery({
    queryKey: ['today-all-results', targets.map(({ game, slot }) => `${game.id}:${slot}`).join(',')],
    staleTime: 5 * 60_000,
    queryFn: async () =>
      (await Promise.all(
        targets.map(async ({ game, slot }) => ({
          game, slot, draw: (await api.recent(game.id as GameId, slot, 1))[0] ?? null,
        })),
      )).filter((x): x is typeof x & { draw: Draw } => x.draw !== null),
  });

  if (all.isLoading) return <Skeleton rows={5} />;
  if (all.isError) return <ErrorBox error={all.error} />;
  if (!all.data?.length) return <p className="inline-note">No drawings loaded yet.</p>;

  return (
    <div className="result-list" style={{ marginTop: 10 }}>
      {[...all.data]
        .sort((a, b) => b.draw.drawDate.localeCompare(a.draw.drawDate))
        .map(({ game, slot, draw }) => (
          <div className="result-row compact" key={game.id}>
            <div className="result-row-head">
              <span className="draw-row-game">{game.name}</span>
              <span className="inline-note">
                {game.slots.length > 1 ? `${slotLabel(game, slot)} · ` : ''}{dateLabel(draw.drawDate)}
              </span>
            </div>
            <div className="ticket-row-nums">
              {draw.numbers.map((n, i) => (
                <Ball key={i} n={n} size="sm" kind={game.kind === 'digits' ? 'digit' : 'main'} />
              ))}
              {game.extraBall && draw.extras[game.extraBall.key] !== undefined && (
                <Ball n={draw.extras[game.extraBall.key]!} size="sm" kind="extra" />
              )}
            </div>
          </div>
        ))}
    </div>
  );
}

function BudgetLine({ label, spent, limit }: { label: string; spent: number; limit: number }) {
  const ratio = limit > 0 ? Math.min(1, spent / limit) : 0;
  const tone = ratio >= 1 ? 'var(--neg)' : ratio > 0.75 ? 'var(--warn)' : 'var(--pos)';
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{label}</span>
        <span className="num" style={{ fontSize: 12.5 }}>{money(spent)} of {money(limit)}</span>
      </div>
      <Meter value={ratio * 100} tone={tone} />
    </div>
  );
}
