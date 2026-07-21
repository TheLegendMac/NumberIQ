/**
 * NumberIQ on Cloudflare Workers.
 *
 * The Worker is deliberately thin: it serves the SPA and does D1 reads/writes,
 * and nothing else. All analysis — statistics, the randomness audit, ticket
 * generation and backtesting — runs in the browser instead.
 *
 * That is not a shortcut, it is the correct shape for this workload. A backtest
 * runs hundreds of Monte Carlo replications over hundreds of drawings, which is
 * seconds of CPU and would blow the Workers CPU limit on any plan's per-request
 * budget. The compute lives in `shared/src/core`, is pure TypeScript with no
 * platform APIs, and therefore runs identically in the browser, in Node, or here.
 */
import {
  GAME_LIST, getGame, isGameId, strategiesForGame, STRATEGIES,
  expectedValuePerTicket, evLowerBound, evaluateTicket,
  saveTicketSchema, settingsSchema,
  type Draw, type GameId, type Ticket,
  currentEraStart, primaryDrawSlot,
} from '@numberiq/shared';
import { ZodError } from 'zod';

const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
} as const;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...SECURITY_HEADERS,
    },
  });

const bad = (message: string, status = 400) => json({ error: 'request_failed', message }, status);

interface DrawRow {
  id: number; game_id: string; draw_date: string; draw_slot: string;
  numbers: string; extras: string; source: string;
}

const toDraw = (r: DrawRow): Draw => ({
  id: r.id,
  gameId: r.game_id as GameId,
  drawDate: r.draw_date,
  drawSlot: r.draw_slot,
  numbers: JSON.parse(r.numbers) as number[],
  extras: JSON.parse(r.extras) as Record<string, number>,
  source: r.source,
});

interface TicketRow {
  id: number; game_id: string; numbers: string; extras: string; strategy: string;
  score: number | null; cost: number; draw_slot: string;
  target_draw_date: string | null; note: string | null; created_at: string;
}

interface PendingTicketRow extends TicketRow {
  draw_id: number;
  draw_numbers: string;
  draw_extras: string;
  draw_source: string;
}

const toTicket = (r: TicketRow): Ticket => ({
  id: r.id,
  gameId: r.game_id as GameId,
  numbers: JSON.parse(r.numbers) as number[],
  extras: JSON.parse(r.extras) as Record<string, number>,
  strategy: r.strategy,
  score: r.score,
  cost: r.cost,
  drawSlot: r.draw_slot,
  targetDrawDate: r.target_draw_date,
  note: r.note,
  createdAt: r.created_at,
});

function resolveSlot(gameId: GameId, requested: string | null): string {
  const game = getGame(gameId);
  return requested && game.slots.includes(requested)
    ? requested
    : primaryDrawSlot(game);
}

/** Check any saved ticket whose target drawing now exists. Idempotent. */
async function checkPending(env: Env): Promise<{ checked: number }> {
  const { results } = await env.DB.prepare(
    `SELECT t.*, d.id AS draw_id, d.numbers AS draw_numbers,
            d.extras AS draw_extras, d.source AS draw_source
       FROM tickets t
       JOIN draws d ON d.game_id = t.game_id
                   AND d.draw_slot = t.draw_slot
                   AND d.draw_date = t.target_draw_date
       LEFT JOIN ticket_results r ON r.ticket_id = t.id AND r.draw_id = d.id
     WHERE t.target_draw_date IS NOT NULL
       AND (r.ticket_id IS NULL OR r.checked_at < d.ingested_at)`,
  ).all<PendingTicketRow>();

  if (!results?.length) return { checked: 0 };

  const stmts: D1PreparedStatement[] = [];
  for (const row of results) {
    const t = toTicket(row);
    if (!t.targetDrawDate) continue;
    const draw: DrawRow = {
      id: row.draw_id,
      game_id: row.game_id,
      draw_date: t.targetDrawDate,
      draw_slot: row.draw_slot,
      numbers: row.draw_numbers,
      extras: row.draw_extras,
      source: row.draw_source,
    };

    const ev = evaluateTicket(getGame(t.gameId), t, toDraw(draw));
    stmts.push(
      env.DB.prepare(
        `INSERT INTO ticket_results (ticket_id, draw_id, matches, extra_match, tier, payout)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (ticket_id, draw_id) DO UPDATE SET
           matches = excluded.matches, extra_match = excluded.extra_match,
           tier = excluded.tier, payout = excluded.payout, checked_at = datetime('now')`,
      ).bind(t.id, draw.id, ev.matches, ev.extraMatch ? 1 : 0, ev.tier?.label ?? null, ev.payout),
    );
  }
  if (stmts.length) await env.DB.batch(stmts);
  return { checked: stmts.length };
}

async function getSettings(env: Env): Promise<Record<string, unknown>> {
  const { results } = await env.DB.prepare(`SELECT key, value FROM settings`).all<{ key: string; value: string }>();
  const out: Record<string, unknown> = {};
  for (const r of results ?? []) {
    try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
  }
  return out;
}

function startOfWeekIso(d = new Date()): string {
  const diff = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff)).toISOString().slice(0, 10);
}
const startOfMonthIso = (d = new Date()) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);

async function budgetStatus(env: Env) {
  const s = await getSettings(env);
  const weeklyBudget = (s.weeklyBudget as number | null) ?? null;
  const monthlyBudget = (s.monthlyBudget as number | null) ?? null;

  const spent = async (since: string) =>
    (await env.DB.prepare(`SELECT COALESCE(SUM(cost), 0) AS s FROM tickets WHERE date(created_at) >= ?`)
      .bind(since).first<{ s: number }>())?.s ?? 0;

  const spentThisWeek = await spent(startOfWeekIso());
  const spentThisMonth = await spent(startOfMonthIso());
  const weeklyRemaining = weeklyBudget === null ? null : weeklyBudget - spentThisWeek;
  const monthlyRemaining = monthlyBudget === null ? null : monthlyBudget - spentThisMonth;
  const exceeded =
    (weeklyRemaining !== null && weeklyRemaining <= 0) ||
    (monthlyRemaining !== null && monthlyRemaining <= 0);

  const advice: string[] = [];
  if (exceeded) advice.push('You have reached the budget you set. Generation is paused until the next period.');
  else if (weeklyRemaining !== null && weeklyBudget && weeklyRemaining < weeklyBudget * 0.25) {
    advice.push(`Only $${weeklyRemaining.toFixed(2)} left of this week's budget.`);
  }
  if (weeklyBudget === null && monthlyBudget === null) {
    advice.push('No budget set. Setting one is the single most effective way to keep this recreational.');
  }
  return {
    weeklyBudget, monthlyBudget, spentThisWeek, spentThisMonth,
    weeklyRemaining, monthlyRemaining, exceeded, advice,
  };
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname.replace(/^\/api/, '') || '/';
  const method = request.method;
  const seg = path.split('/').filter(Boolean);

  // --- health -------------------------------------------------------------
  if (path === '/health' && method === 'GET') {
    const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM draws`).first<{ n: number }>();
    return json({ ok: true, draws: row?.n ?? 0, runtime: 'cloudflare-workers' });
  }

  // --- games --------------------------------------------------------------
  if (path === '/games' && method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT game_id, draw_slot AS slot, COUNT(*) AS count,
              MIN(draw_date) AS first, MAX(draw_date) AS last,
              MAX(ingested_at) AS updated_at
       FROM draws GROUP BY game_id, draw_slot`,
    ).all<{
      game_id: string; slot: string; count: number;
      first: string; last: string; updated_at: string;
    }>();

    const byGame = new Map<string, Array<{
      slot: string; count: number; first: string; last: string; updatedAt: string;
    }>>();
    for (const r of results ?? []) {
      const list = byGame.get(r.game_id) ?? [];
      list.push({
        slot: r.slot, count: r.count, first: r.first, last: r.last,
        updatedAt: r.updated_at,
      });
      byGame.set(r.game_id, list);
    }

    return json(GAME_LIST.map((g) => {
      const data = byGame.get(g.id) ?? [];
      const updatedAt = data.map((row) => row.updatedAt).sort().at(-1) ?? null;
      return {
        ...g,
        strategies: strategiesForGame(g).map((s) => s.id),
        expectedValue: expectedValuePerTicket(g),
        expectedValueLowerBound: evLowerBound(g),
        data,
        lastSync: updatedAt
          ? { ran_at: updatedAt, added: 0, source: 'published:D1' }
          : null,
      };
    }));
  }

  if (seg[0] === 'games' && seg[2] === 'odds' && method === 'GET') {
    if (!isGameId(seg[1])) return bad(`Unknown game "${seg[1]}"`);
    const g = getGame(seg[1]);
    const ev = expectedValuePerTicket(g);
    return json({
      game: g,
      officialOdds: { topPrize: g.topPrizeOneIn, overall: g.overallOneIn, tiers: g.prizeTiers },
      expectedValue: ev,
      expectedValueLowerBound: evLowerBound(g),
      returnRate: ev === null ? null : ev / g.basePrice,
      disclosure:
        g.payoutModel === 'fixed'
          ? `${g.name} pays fixed, posted amounts. Every combination has identical odds and an identical prize, so no selection method can change expected value.`
          : `${g.name} splits prizes among winners in a tier. Selection cannot change your odds of winning, but avoiding widely-picked combinations increases what you would collect if you win.`,
    });
  }

  /**
   * Per-game draw counts for every number, aggregated in D1 via json_each so the
   * browser never has to pull ~84k drawings to count them. Restricted to each
   * game's current matrix era — see currentEraStart.
   */
  if (path === '/frequency' && method === 'GET') {
    const out: unknown[] = [];

    for (const game of GAME_LIST) {
      const since = currentEraStart(game);
      const rows = await env.DB.prepare(
        `SELECT json_each.value AS n, COUNT(*) AS c
           FROM draws, json_each(draws.numbers)
          WHERE draws.game_id = ?1 ${since ? 'AND draws.draw_date >= ?2' : ''}
          GROUP BY n ORDER BY n`,
      )
        .bind(...(since ? [game.id, since] : [game.id]))
        .all<{ n: number; c: number }>();

      const meta = await env.DB.prepare(
        `SELECT COUNT(*) AS draws, MIN(draw_date) AS first, MAX(draw_date) AS last
           FROM draws WHERE game_id = ?1 ${since ? 'AND draw_date >= ?2' : ''}`,
      )
        .bind(...(since ? [game.id, since] : [game.id]))
        .first<{ draws: number; first: string; last: string }>();

      const counts = rows.results ?? [];
      if (!counts.length || !meta) continue;

      out.push({
        gameId: game.id,
        name: game.name,
        kind: game.kind,
        drawCount: meta.draws,
        from: meta.first,
        to: meta.last,
        eraStart: since,
        counts: counts.map((r) => ({ n: Number(r.n), count: Number(r.c) })),
      });
    }

    return json(out);
  }

  if (path === '/strategies' && method === 'GET') {
    const id = url.searchParams.get('gameId');
    return json(id && isGameId(id) ? strategiesForGame(getGame(id)) : STRATEGIES);
  }

  // --- draws (the client computes everything from these) -------------------
  if (seg[0] === 'draws' && seg[1] && method === 'GET') {
    if (!isGameId(seg[1])) return bad(`Unknown game "${seg[1]}"`);
    const slot = resolveSlot(seg[1], url.searchParams.get('slot'));
    const requested = Number(url.searchParams.get('limit') ?? 20_000);
    const limit = Number.isFinite(requested)
      ? Math.max(1, Math.min(Math.floor(requested), 20_000))
      : 100;
    const { results } = await env.DB.prepare(
      `SELECT * FROM draws WHERE game_id = ? AND draw_slot = ? ORDER BY draw_date DESC LIMIT ?`,
    ).bind(seg[1], slot, limit).all<DrawRow>();
    return json({ slot, draws: (results ?? []).map(toDraw) });
  }

  if (seg[0] === 'data' && seg[1] && method === 'GET') {
    if (!isGameId(seg[1])) return bad(`Unknown game "${seg[1]}"`);
    const { results } = await env.DB.prepare(
      `SELECT draw_slot AS slot, COUNT(*) AS count,
              MIN(draw_date) AS first, MAX(draw_date) AS last,
              MAX(ingested_at) AS updated_at
       FROM draws WHERE game_id = ? GROUP BY draw_slot`,
    ).bind(seg[1]).all<{
      slot: string; count: number; first: string; last: string; updated_at: string;
    }>();
    const rows = results ?? [];
    const updatedAt = rows.map((row) => row.updated_at).sort().at(-1) ?? null;
    return json({
      summary: rows.map(({ updated_at: _updatedAt, ...row }) => row),
      // Gap analysis and PDF sync are local-only operations; see README.
      gaps: rows.map((r) => ({
        slot: r.slot, count: r.count, first: r.first, last: r.last,
        missing: [], outOfOrder: false, expectedPerWeek: 0,
        scanWindow: { from: r.first, to: r.last, note: 'Gap analysis runs in the local CLI, not on the hosted deployment.' },
      })),
      lastSync: updatedAt
        ? { ran_at: updatedAt, added: 0, source: 'published:D1' }
        : null,
    });
  }

  // Ingest is intentionally not exposed: it downloads and parses ~87k drawings
  // from official PDFs, which is far beyond a Worker's CPU budget, and an open
  // endpoint would let anyone make this Worker hammer the Lottery's servers.
  if (seg[0] === 'data' && (seg[2] === 'sync' || seg[2] === 'import')) {
    return json({
      error: 'not_available_on_hosted',
      message:
        'Data ingest runs locally, not on the hosted deployment. Run `npx tsx server/src/cli/seed.ts` ' +
        'then `npm run d1:push` to publish drawings to D1.',
    }, 501);
  }

  // --- tickets ------------------------------------------------------------
  if (path === '/tickets' && method === 'GET') {
    await checkPending(env);
    const gameId = url.searchParams.get('gameId');
    const q = gameId && isGameId(gameId)
      ? env.DB.prepare(`SELECT * FROM tickets WHERE game_id = ? ORDER BY created_at DESC, id DESC`).bind(gameId)
      : env.DB.prepare(`SELECT * FROM tickets ORDER BY created_at DESC, id DESC`);
    const { results } = await q.all<TicketRow>();

    const res = await env.DB.prepare(
      `SELECT ticket_id AS ticketId, payout, matches, tier FROM ticket_results`,
    ).all<{ ticketId: number; payout: number; matches: number; tier: string | null }>();
    const byId = new Map((res.results ?? []).map((r) => [r.ticketId, r]));

    return json((results ?? []).map((r) => ({ ...toTicket(r), result: byId.get(r.id) ?? null })));
  }

  if (path === '/tickets' && method === 'POST') {
    const body = await request.json();
    const rawList = Array.isArray(body) ? body : [body];
    if (rawList.length === 0) return bad('At least one ticket is required');
    if (rawList.length > 200) return bad('Too many tickets in one request (max 200)', 413);
    const list = rawList.map((ticket) => saveTicketSchema.parse(ticket));

    const stmts = list.map((t) =>
      env.DB.prepare(
        `INSERT INTO tickets (game_id, numbers, extras, strategy, score, cost, draw_slot, target_draw_date, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        t.gameId, JSON.stringify(t.numbers), JSON.stringify(t.extras ?? {}),
        t.strategy, t.score, t.cost, t.drawSlot, t.targetDrawDate, t.note ?? null,
      ),
    );
    const writes = await env.DB.batch(stmts);
    await checkPending(env);
    return json({ ids: writes.map((write) => write.meta.last_row_id), saved: list.length }, 201);
  }

  if (seg[0] === 'tickets' && seg[1] && method === 'DELETE') {
    const id = Number(seg[1]);
    if (!Number.isInteger(id) || id <= 0) return bad('Ticket id must be a positive integer');
    const r = await env.DB.prepare(`DELETE FROM tickets WHERE id = ?`).bind(id).run();
    return new Response(null, {
      status: r.meta.changes > 0 ? 204 : 404,
      headers: SECURITY_HEADERS,
    });
  }

  // --- tracker ------------------------------------------------------------
  if (path === '/tracker' && method === 'GET') {
    const justChecked = await checkPending(env);
    const { results } = await env.DB.prepare(
      `SELECT t.id, t.game_id, t.strategy, t.cost, t.target_draw_date, t.created_at,
              COALESCE(r.payout, 0) AS payout, r.tier, (r.ticket_id IS NOT NULL) AS checked
       FROM tickets t LEFT JOIN ticket_results r ON r.ticket_id = t.id`,
    ).all<{
      id: number; game_id: string; strategy: string; cost: number;
      target_draw_date: string | null; created_at: string;
      payout: number; tier: string | null; checked: number;
    }>();

    const rows = results ?? [];
    let spend = 0, winnings = 0, checkedCount = 0;
    const byStrategy = new Map<string, { tickets: number; spend: number; winnings: number; wins: number }>();
    const byGame = new Map<string, { tickets: number; spend: number; winnings: number }>();
    let biggestWin: { amount: number; tier: string | null; date: string } | null = null;

    for (const r of rows) {
      spend += r.cost;
      winnings += r.payout;
      if (r.checked) checkedCount++;

      const s = byStrategy.get(r.strategy) ?? { tickets: 0, spend: 0, winnings: 0, wins: 0 };
      s.tickets++; s.spend += r.cost; s.winnings += r.payout;
      if (r.tier !== null) s.wins++;
      byStrategy.set(r.strategy, s);

      const g = byGame.get(r.game_id) ?? { tickets: 0, spend: 0, winnings: 0 };
      g.tickets++; g.spend += r.cost; g.winnings += r.payout;
      byGame.set(r.game_id, g);

      if (r.payout > 0 && (!biggestWin || r.payout > biggestWin.amount)) {
        biggestWin = { amount: r.payout, tier: r.tier, date: r.target_draw_date ?? r.created_at };
      }
    }

    return json({
      ticketCount: rows.length,
      checkedCount,
      pendingCount: rows.length - checkedCount,
      spend, winnings,
      net: winnings - spend,
      roi: spend > 0 ? (winnings - spend) / spend : 0,
      byStrategy: [...byStrategy.entries()].map(([strategy, v]) => ({
        strategy, ...v, net: v.winnings - v.spend, roi: v.spend > 0 ? (v.winnings - v.spend) / v.spend : 0,
      })).sort((a, b) => b.spend - a.spend),
      byGame: [...byGame.entries()].map(([gameId, v]) => ({ gameId, ...v, net: v.winnings - v.spend }))
        .sort((a, b) => b.spend - a.spend),
      biggestWin,
      justChecked,
    });
  }

  // --- settings -----------------------------------------------------------
  if (path === '/settings' && method === 'GET') {
    return json({ settings: await getSettings(env), budget: await budgetStatus(env) });
  }

  if (path === '/settings' && method === 'PUT') {
    const values = settingsSchema.parse(await request.json());
    const entries = Object.entries(values);
    if (entries.length) {
      await env.DB.batch(entries.map(([k, v]) =>
        env.DB.prepare(
          `INSERT INTO settings (key, value) VALUES (?, ?)
           ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
        ).bind(k, JSON.stringify(v)),
      ));
    }
    return json({ settings: await getSettings(env), budget: await budgetStatus(env) });
  }

  return json({ error: 'not_found', message: `No API route for ${method} ${path}` }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (err instanceof ZodError) {
          return json({
            error: 'validation_failed',
            message: 'Request did not match the expected shape.',
            issues: err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
          }, 400);
        }
        if (err instanceof SyntaxError) {
          return bad('Request body must be valid JSON');
        }
        // Surface a missing schema clearly rather than as an opaque 500.
        if (/no such table/i.test(message)) {
          return json({
            error: 'database_not_initialised',
            message: 'D1 has no schema yet. Run: npx wrangler d1 migrations apply numberiq --remote',
          }, 503);
        }
        console.error(JSON.stringify({
          message: 'request_failed',
          method: request.method,
          path: url.pathname,
          error: message,
        }));
        return json({ error: 'request_failed', message: 'The request could not be completed.' }, 500);
      }
    }

    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
} satisfies ExportedHandler<Env>;
