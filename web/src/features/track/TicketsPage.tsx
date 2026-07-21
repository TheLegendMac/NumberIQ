import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, money, pct, dateLabel, slotLabel, type GameSummary } from '../../lib/api.js';
import { Button, Card, Chip, Field, Input, Notice, Stat, Skeleton, EmptyState, Ball } from '../../components/ui.js';

export function TicketsPage({ games }: { games: GameSummary[] }) {
  const qc = useQueryClient();
  const tracker = useQuery({ queryKey: ['tracker'], queryFn: api.tracker });
  const tickets = useQuery({ queryKey: ['tickets'], queryFn: api.tickets });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });

  const [weekly, setWeekly] = useState('');
  const [monthly, setMonthly] = useState('');

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

  return (
    <>
      <header className="page-head">
        <h1>Tickets</h1>
        <p>Your actual position. Saved tickets are checked automatically as results arrive.</p>
      </header>

      {tracker.isLoading && <Card><Skeleton rows={4} /></Card>}

      {t && (
        <>
          {/* Net position leads and is the largest figure on the page — by design. */}
          <Card>
            <div className="grid grid-4">
              <Stat
                label="Net position"
                large
                value={money(t.net)}
                tone={t.net < 0 ? 'neg' : t.net > 0 ? 'pos' : undefined}
                hint={t.spend > 0 ? `${pct(t.roi)} return on ${money(t.spend)} spent` : 'No spend recorded yet'}
              />
              <Stat label="Total spent" value={money(t.spend)} hint={`${t.ticketCount} tickets`} />
              <Stat label="Total won" value={money(t.winnings)} hint={t.biggestWin ? `Best: ${money(t.biggestWin.amount)}` : 'No wins yet'} />
              <Stat
                label="Checked"
                value={`${t.checkedCount} / ${t.ticketCount}`}
                hint={t.pendingCount > 0 ? `${t.pendingCount} awaiting their draw` : 'All results in'}
              />
            </div>

            {t.spend > 0 && (
              <div style={{ marginTop: 16 }}>
                <Notice tone={t.net < 0 ? 'warn' : 'neutral'} icon={t.net < 0 ? '!' : 'i'}>
                  {t.net < 0 ? (
                    <>You are down <strong>{money(Math.abs(t.net))}</strong> across {t.ticketCount} tickets.
                    This is the expected outcome — every game here returns less than it costs. The
                    figure is shown as prominently as any win because that is the honest picture.</>
                  ) : (
                    <>You are currently ahead by <strong>{money(t.net)}</strong>. Over a longer run
                    this will trend negative — the games are designed that way. Enjoy it, but do not
                    read it as a working strategy.</>
                  )}
                </Notice>
              </div>
            )}
          </Card>

          <div className="grid grid-2" style={{ marginTop: 14 }}>
            <Card title="Budget" sub="A ceiling that actually blocks generation when reached.">
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <Field label="Weekly limit">
                  <Input type="number" min={0} step={1} value={weekly} placeholder="none"
                    onChange={(e) => setWeekly(e.target.value)} style={{ width: 120 }} />
                </Field>
                <Field label="Monthly limit">
                  <Input type="number" min={0} step={1} value={monthly} placeholder="none"
                    onChange={(e) => setMonthly(e.target.value)} style={{ width: 120 }} />
                </Field>
                <Button onClick={() => saveBudget.mutate()} disabled={saveBudget.isPending}>
                  {saveBudget.isPending ? 'Saving…' : 'Save'}
                </Button>
              </div>

              {budget && (
                <div style={{ marginTop: 14, display: 'grid', gap: 8 }}>
                  <div className="row" style={{ justifyContent: 'space-between', fontSize: 12.5 }}>
                    <span style={{ color: 'var(--muted)' }}>This week</span>
                    <span className="num">
                      {money(budget.spentThisWeek)}
                      {budget.weeklyBudget !== null && ` of ${money(budget.weeklyBudget)}`}
                    </span>
                  </div>
                  <div className="row" style={{ justifyContent: 'space-between', fontSize: 12.5 }}>
                    <span style={{ color: 'var(--muted)' }}>This month</span>
                    <span className="num">
                      {money(budget.spentThisMonth)}
                      {budget.monthlyBudget !== null && ` of ${money(budget.monthlyBudget)}`}
                    </span>
                  </div>
                  {budget.advice.map((a, i) => (
                    <p key={i} className="inline-note">{a}</p>
                  ))}
                </div>
              )}
            </Card>

            <Card title="By strategy" sub="Differences here are sampling noise, not skill.">
              {t.byStrategy.length === 0 ? (
                <p className="inline-note">No tickets saved yet.</p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr><th>Strategy</th><th className="t-right">Tickets</th><th className="t-right">Spent</th><th className="t-right">Won</th><th className="t-right">Net</th></tr>
                    </thead>
                    <tbody>
                      {t.byStrategy.map((s) => (
                        <tr key={s.strategy}>
                          <td>{s.strategy}</td>
                          <td className="t-right num">{s.tickets}</td>
                          <td className="t-right num">{money(s.spend)}</td>
                          <td className="t-right num">{money(s.winnings)}</td>
                          <td className="t-right num" style={{ color: s.net < 0 ? 'var(--neg)' : 'var(--pos)' }}>{money(s.net)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </>
      )}

      <div style={{ marginTop: 14 }}>
        <Card title="Saved tickets" sub={tickets.data?.length ? `${tickets.data.length} total` : undefined}>
          {tickets.isLoading && <Skeleton rows={3} />}
          {tickets.data?.length === 0 && (
            <EmptyState title="No saved tickets">
              Generate some tickets and press Save to start tracking your position.
            </EmptyState>
          )}
          {tickets.data && tickets.data.length > 0 && (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Game</th><th>Numbers</th><th>Strategy</th>
                    <th className="t-right">Cost</th><th>Target draw</th><th>Result</th><th />
                  </tr>
                </thead>
                <tbody>
                  {tickets.data.map((ticket) => {
                    const game = games.find((g) => g.id === ticket.gameId);
                    return (
                      <tr key={ticket.id}>
                        <td>
                          {game?.shortName ?? ticket.gameId}
                          {game && game.slots.length > 1 && (
                            <span className="inline-note"> · {slotLabel(game, ticket.drawSlot)}</span>
                          )}
                        </td>
                        <td>
                          <span className="row-tight">
                            {ticket.numbers.map((n, i) => (
                              <Ball key={i} n={n} size="sm" kind={game?.kind === 'digits' ? 'digit' : 'main'} />
                            ))}
                            {game?.extraBall && ticket.extras[game.extraBall.key] !== undefined && (
                              <Ball n={ticket.extras[game.extraBall.key]!} size="sm" kind="extra" />
                            )}
                          </span>
                        </td>
                        <td style={{ color: 'var(--muted)' }}>{ticket.strategy}</td>
                        <td className="t-right num">{money(ticket.cost)}</td>
                        <td style={{ color: 'var(--muted)' }}>
                          {ticket.targetDrawDate ? dateLabel(ticket.targetDrawDate) : '—'}
                        </td>
                        <td>
                          {ticket.result ? (
                            ticket.result.payout > 0 ? (
                              <Chip tone="pos">Won {money(ticket.result.payout)}</Chip>
                            ) : (
                              <Chip>{ticket.result.matches} matched</Chip>
                            )
                          ) : (
                            <Chip>Pending</Chip>
                          )}
                        </td>
                        <td className="t-right">
                          <Button size="sm" variant="ghost" className="btn-danger"
                            onClick={() => remove.mutate(ticket.id)} aria-label="Delete ticket">
                            ✕
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="inline-note" style={{ marginTop: 10 }}>
            Tickets saved without a target draw date stay pending. Set a date to have NumberIQ check
            them automatically once that drawing is ingested.
          </p>
        </Card>
      </div>
    </>
  );
}
