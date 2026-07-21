import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { nextDrawing, formatCountdown, describeSchedule } from '@numberiq/shared';
import { api, money, pct, dateLabel, slotLabel, type GameSummary } from '../../lib/api.js';
import { Button, Card, Chip, Field, Input, Stat, Skeleton, EmptyState, Ball, Fold, ErrorBox, Meter } from '../../components/ui.js';
import { Term, Reading } from '../../components/Term.js';

export function TicketsPage({ games }: { games: GameSummary[] }) {
  const qc = useQueryClient();
  const tracker = useQuery({ queryKey: ['tracker'], queryFn: api.tracker });
  const tickets = useQuery({ queryKey: ['tickets'], queryFn: api.tickets });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });

  const [weekly, setWeekly] = useState('');
  const [monthly, setMonthly] = useState('');
  const [, setTick] = useState(0);

  // Keep countdowns honest without a full refetch.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!settings.data) return;
    setWeekly(settings.data.budget.weeklyBudget?.toString() ?? '');
    setMonthly(settings.data.budget.monthlyBudget?.toString() ?? '');
  }, [settings.data]);

  const saveBudget = useMutation({
    mutationFn: () =>
      api.saveSettings({
        weeklyBudget: weekly === '' ? null : Number(weekly),
        monthlyBudget: monthly === '' ? null : Number(monthly),
      }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['settings'] }); },
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.deleteTicket(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tickets'] });
      void qc.invalidateQueries({ queryKey: ['tracker'] });
    },
  });

  const t = tracker.data;
  const budget = settings.data?.budget;

  // Games you actually hold tickets for, soonest drawing first.
  const upcoming = games
    .map((g) => ({ game: g, next: nextDrawing(g.id) }))
    .filter((x): x is { game: GameSummary; next: NonNullable<ReturnType<typeof nextDrawing>> } => x.next !== null)
    .sort((a, b) => a.next.msUntil - b.next.msUntil);

  return (
    <>
      <header className="page-head">
        <h1>Tickets</h1>
        <p>Where you actually stand. Saved tickets are checked automatically once results land.</p>
      </header>

      {tracker.isError && <ErrorBox error={tracker.error} />}
      {tickets.isError && <ErrorBox error={tickets.error} />}
      {settings.isError && <ErrorBox error={settings.error} />}
      {saveBudget.isError && <ErrorBox error={saveBudget.error} />}
      {remove.isError && <ErrorBox error={remove.error} />}

      {tracker.isLoading && <Card><Skeleton rows={4} /></Card>}

      {t && (
        <>
          {/* Net position leads and is the largest figure on the page — by design. */}
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
                label="Checked" value={`${t.checkedCount} / ${t.ticketCount}`}
                hint={t.pendingCount > 0 ? `${t.pendingCount} awaiting their drawing` : 'All results in'}
              />
            </div>

            {t.spend > 0 && (
              <div style={{ marginTop: 14 }}>
                <Reading
                  tone={t.net < 0 ? 'warn' : 'pos'}
                  plain={t.net < 0
                    ? <>You are down <strong>{money(Math.abs(t.net))}</strong> across {t.ticketCount} tickets.
                      That is the expected outcome — every game here pays back less than it costs. This
                      number is shown as prominently as any win because that is the honest picture.</>
                    : <>You are ahead by <strong>{money(t.net)}</strong> right now. Over a longer run this
                      trends negative; the games are built that way. Enjoy it, but do not read it as a
                      working strategy.</>}
                  technical={<><Term id="roi">ROI</Term> {pct(t.roi)} · {money(t.spend)} spent · {money(t.winnings)} returned</>}
                />
              </div>
            )}
          </Card>

          {/* --- Drawing schedule --- */}
          <div style={{ marginTop: 14 }}>
            <Card title="Upcoming drawings" sub="All times are Florida time (ET), shown soonest first.">
              <div className="draw-list">
                {upcoming.slice(0, 6).map(({ game, next }) => (
                  <div className="draw-row" key={game.id}>
                    <div className="draw-row-main">
                      <span className="draw-row-game">{game.name}</span>
                      <span className="inline-note">{describeSchedule(game.id)}</span>
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
              <Fold summary="Every game's schedule">
                <div className="draw-list" style={{ marginTop: 10 }}>
                  {upcoming.map(({ game, next }) => (
                    <div className="draw-row" key={game.id}>
                      <div className="draw-row-main">
                        <span className="draw-row-game">{game.name}</span>
                        <span className="inline-note">{describeSchedule(game.id)}</span>
                      </div>
                      <div className="draw-row-when">
                        <span className="draw-row-count">{dateLabel(next.drawDate)}</span>
                        <span className="inline-note">{next.timeLabel}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="inline-note" style={{ marginTop: 10 }}>
                  Drawing times occasionally change. Verify against the Florida Lottery before relying
                  on one to buy a ticket.
                </p>
              </Fold>
            </Card>
          </div>

          <div className="grid grid-2" style={{ marginTop: 14 }}>
            <Card title="Budget" sub="A ceiling that actually blocks generation when you reach it.">
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <Field label="Weekly limit">
                  <Input type="number" min={0} step={1} value={weekly} placeholder="none"
                    onChange={(e) => setWeekly(e.target.value)} style={{ width: 118 }} />
                </Field>
                <Field label="Monthly limit">
                  <Input type="number" min={0} step={1} value={monthly} placeholder="none"
                    onChange={(e) => setMonthly(e.target.value)} style={{ width: 118 }} />
                </Field>
                <Button onClick={() => saveBudget.mutate()} disabled={saveBudget.isPending}>
                  {saveBudget.isPending ? 'Saving…' : 'Save'}
                </Button>
              </div>
              {saveBudget.isSuccess && <p className="inline-note" role="status">Budget saved.</p>}

              {budget && (
                <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
                  {budget.weeklyBudget !== null && (
                    <BudgetBar label="This week" spent={budget.spentThisWeek} limit={budget.weeklyBudget} />
                  )}
                  {budget.monthlyBudget !== null && (
                    <BudgetBar label="This month" spent={budget.spentThisMonth} limit={budget.monthlyBudget} />
                  )}
                  {/* Advice comes from the server so it stays in sync with the
                      budget gate that actually blocks generation. */}
                  {budget.advice.map((a, i) => <p key={i} className="inline-note">{a}</p>)}
                </div>
              )}
            </Card>

            <Card title="By strategy" sub="Differences here are sampling noise, not skill.">
              {t.byStrategy.length === 0 ? (
                <p className="inline-note">Nothing saved yet.</p>
              ) : (
                <div style={{ display: 'grid', gap: 10 }}>
                  {t.byStrategy.map((s) => (
                    <div key={s.strategy} className="row" style={{ justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 550 }}>{s.strategy}</div>
                        <div className="inline-note">{s.tickets} tickets · {s.wins} won</div>
                      </div>
                      <span className="num" style={{ fontSize: 14, fontWeight: 620, color: s.net < 0 ? 'var(--neg)' : 'var(--pos)' }}>
                        {money(s.net)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}

      {/* --- Saved tickets: cards on mobile, table on desktop --- */}
      <div style={{ marginTop: 14 }}>
        <Card title="Saved tickets" sub={tickets.data?.length ? `${tickets.data.length} total` : undefined}>
          {tickets.isLoading && <Skeleton rows={3} />}
          {tickets.data?.length === 0 && (
            <EmptyState title="No saved tickets">
              Generate some numbers and press Save. They are checked automatically once the drawing happens.
            </EmptyState>
          )}
          {tickets.data && tickets.data.length > 0 && (
            <div className="ticket-list">
              {tickets.data.map((ticket) => {
                const game = games.find((g) => g.id === ticket.gameId);
                const won = ticket.result && ticket.result.payout > 0;
                const unvaluedWin = ticket.result && ticket.result.payout === 0 && ticket.result.tier !== null;
                return (
                  <div className="ticket-row" key={ticket.id}>
                    <div className="ticket-row-nums">
                      {ticket.numbers.map((n, i) => (
                        <Ball key={i} n={n} size="sm" kind={game?.kind === 'digits' ? 'digit' : 'main'} />
                      ))}
                      {game?.extraBall && ticket.extras[game.extraBall.key] !== undefined && (
                        <Ball n={ticket.extras[game.extraBall.key]!} size="sm" kind="extra" />
                      )}
                    </div>

                    <div className="ticket-row-meta">
                      <span style={{ fontWeight: 550 }}>{game?.name ?? ticket.gameId}</span>
                      <span className="inline-note">
                        {game && game.slots.length > 1 ? `${slotLabel(game, ticket.drawSlot)} · ` : ''}
                        {ticket.strategy} · {money(ticket.cost)}
                        {ticket.targetDrawDate ? ` · ${dateLabel(ticket.targetDrawDate)}` : ''}
                      </span>
                    </div>

                    <div className="ticket-row-result">
                      {ticket.result ? (
                        won
                          ? <Chip tone="pos">Won {money(ticket.result.payout)}</Chip>
                          : unvaluedWin
                            ? <Chip tone="pos">Hit {ticket.result.tier} · verify prize</Chip>
                          : <Chip>{ticket.result.matches} matched</Chip>
                      ) : (
                        <Chip tone="warn">Waiting</Chip>
                      )}
                      <Button size="sm" variant="ghost" className="btn-danger"
                        onClick={() => remove.mutate(ticket.id)}
                        disabled={remove.isPending}
                        aria-label={`Delete ${game?.name ?? ticket.gameId} ticket ${ticket.numbers.join('-')}`}
                      >✕</Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function BudgetBar({ label, spent, limit }: { label: string; spent: number; limit: number }) {
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
