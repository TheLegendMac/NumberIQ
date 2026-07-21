import { useRef, useState } from 'react';
import { useMutation, useQueries, useQueryClient, useQuery } from '@tanstack/react-query';
import type { GameId } from '@numberiq/shared';
import { api, dateLabel, invalidateDraws, slotLabel, type GameSummary, type IngestReport } from '../../lib/api.js';
import { latestDataDate } from '../../lib/gameData.js';
import { Button, Card, Chip, Notice, Skeleton, ErrorBox } from '../../components/ui.js';

export function DataPage({ games }: { games: GameSummary[] }) {
  const qc = useQueryClient();
  // Where the data actually lives changes what this page can honestly claim.
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, staleTime: 5 * 60_000 });
  const hosted = health.data?.runtime === 'cloudflare-workers';
  const local = health.isSuccess && !hosted;
  const dataThrough = latestDataDate(games.flatMap((g) => g.data));
  const [report, setReport] = useState<(IngestReport & { mapping?: Record<string, string> }) | null>(null);
  const [busy, setBusy] = useState<GameId | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [importTarget, setImportTarget] = useState<GameId | null>(null);
  const [operationError, setOperationError] = useState<Error | null>(null);

  const dataQueries = useQueries({
    queries: games.map((g) => ({ queryKey: ['data', g.id], queryFn: () => api.data(g.id) })),
  });

  const invalidate = () => {
    invalidateDraws();
    void qc.invalidateQueries({ queryKey: ['games'] });
    void qc.invalidateQueries({ queryKey: ['data'] });
    void qc.invalidateQueries({ queryKey: ['stats'] });
    void qc.invalidateQueries({ queryKey: ['randomness'] });
    void qc.invalidateQueries({ queryKey: ['frequency'] });
    void qc.invalidateQueries({ queryKey: ['today-results'] });
    void qc.invalidateQueries({ queryKey: ['today-all-results'] });
  };

  const sync = useMutation({
    mutationFn: (id: GameId) => api.sync(id, true),
    onMutate: (id) => { setBusy(id); setOperationError(null); },
    onSettled: () => setBusy(null),
    onSuccess: (r) => { setReport(r); invalidate(); },
    onError: (error) => setOperationError(error),
  });

  const importFile = useMutation({
    mutationFn: async ({ id, file }: { id: GameId; file: File }) => {
      const buf = await file.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      }
      return api.importFile(id, file.name, btoa(binary));
    },
    onMutate: ({ id }) => { setBusy(id); setOperationError(null); },
    onSettled: () => setBusy(null),
    onSuccess: (r) => { setReport(r); invalidate(); },
    onError: (error) => setOperationError(error),
  });

  const syncAll = async () => {
    setOperationError(null);
    const failures: string[] = [];
    for (const g of games) {
      setBusy(g.id);
      try {
        const result = await api.sync(g.id, true);
        setReport(result);
      } catch (error) {
        failures.push(`${g.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    setBusy(null);
    invalidate();
    if (failures.length) setOperationError(new Error(failures.join(' · ')));
  };

  return (
    <>
      <header className="page-head">
        <h1>Data</h1>
        <p>
          {health.isLoading
            ? 'Checking where drawing history is stored…'
            : hosted
            ? 'Official Florida Lottery history, stored in your own Cloudflare D1 database.'
            : local
              ? 'Official Florida Lottery history, stored locally. Nothing leaves your machine.'
              : 'Drawing-history storage could not be reached.'}
        </p>
        {dataThrough && (
          <div className="row-tight" style={{ marginTop: 10 }}>
            <Chip tone="accent">Latest loaded draw {dateLabel(dataThrough)}</Chip>
          </div>
        )}
      </header>

      {health.isError && <ErrorBox error={health.error} />}
      {operationError && <ErrorBox error={operationError} />}
      {dataQueries.some((query) => query.isError) && (
        <ErrorBox error={new Error('One or more game summaries could not be loaded.')} />
      )}

      {hosted && (
        <div style={{ marginBottom: 14 }}>
          <Notice tone="neutral" icon="i">
            <strong>This is the hosted deployment.</strong> Drawing history lives in Cloudflare D1,
            not on your machine. Downloading and parsing the Lottery's PDFs is a local-only task —
            it exceeds what a Worker may compute, and an open sync endpoint would let anyone point
            this deployment at the Lottery's servers. Run <code>npm run d1:seed</code> locally to
            refresh what is stored here.
          </Notice>
        </div>
      )}

      <Card
        title="Sources"
        sub={!health.isSuccess
          ? 'Waiting for the data runtime before enabling maintenance actions.'
          : hosted
            ? 'Published to D1 from a local ingest run. Syncing and importing are disabled here.'
            : "Downloaded from the Florida Lottery's own published winning-number history files."}
        actions={local ? <Button onClick={syncAll} disabled={busy !== null}>Sync all games</Button> : undefined}
      >
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Game</th><th className="t-right">Draws</th><th>Data freshness</th>
                <th>Drawings</th><th className="t-right">Gaps</th><th />
              </tr>
            </thead>
            <tbody>
              {games.map((g, i) => {
                const q = dataQueries[i];
                const summary = q?.data?.summary ?? [];
                const total = summary.reduce((s, d) => s + d.count, 0);
                const gaps = q?.data?.gaps ?? [];
                const missing = gaps.reduce((s, x) => s + x.missing.length, 0);
                const first = summary.map((s) => s.first).sort()[0];
                const last = latestDataDate(summary);

                return (
                  <tr key={g.id}>
                    <td>
                      <div style={{ fontWeight: 550 }}>{g.name}</div>
                      <div className="inline-note">
                        {g.payoutModel === 'fixed' ? 'Fixed payout' :
                         g.payoutModel === 'parimutuel' ? 'Pari-mutuel' : 'Split jackpot'}
                      </div>
                    </td>
                    <td className="t-right num">{total > 0 ? total.toLocaleString() : '—'}</td>
                    <td style={{ color: 'var(--muted)', fontSize: 12.5 }}>
                      {first && last ? (
                        <>
                          <div style={{ color: 'var(--text-dim)' }}>Data current through {dateLabel(last)}</div>
                          <div className="inline-note">History starts {dateLabel(first)}</div>
                        </>
                      ) : 'Not loaded'}
                    </td>
                    <td>
                      <div className="row-tight">
                        {summary.map((s) => (
                          <Chip key={s.slot}>{slotLabel(g, s.slot)} {s.count.toLocaleString()}</Chip>
                        ))}
                      </div>
                    </td>
                    <td className="t-right">
                      {hosted
                        ? <span className="inline-note">local only</span>
                        : !local ? <span className="inline-note">checking…</span>
                        : q?.isLoading ? '…'
                        : q?.isError ? <Chip tone="warn">Unavailable</Chip>
                        : missing === 0 ? <Chip tone="pos">None</Chip>
                        : <Chip tone="warn">{missing}</Chip>}
                    </td>
                    <td className="t-right">
                      <div className="row-tight" style={{ justifyContent: 'flex-end' }}>
                        {hosted ? (
                          <span className="inline-note">read-only</span>
                        ) : !local ? (
                          <span className="inline-note">checking…</span>
                        ) : (
                          <>
                            <Button size="sm" onClick={() => sync.mutate(g.id)} disabled={busy !== null}>
                              {busy === g.id ? 'Syncing…' : 'Sync'}
                            </Button>
                            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => { setImportTarget(g.id); fileInput.current?.click(); }}>
                              Import
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept=".csv,.xlsx,.xls,text/csv"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file && importTarget) importFile.mutate({ id: importTarget, file });
            e.target.value = '';
          }}
        />

        {dataQueries.some((q) => q.isLoading) && <div style={{ marginTop: 12 }}><Skeleton rows={2} /></div>}
      </Card>

      {(sync.isPending || importFile.isPending) && (
        <div style={{ marginTop: 14 }}><Card><Skeleton rows={2} /></Card></div>
      )}

      {report && (
        <div style={{ marginTop: 14 }}>
          <Card title="Last ingest" sub={report.source}>
            <div className="row-tight">
              <Chip tone="pos">{report.added.toLocaleString()} added</Chip>
              {report.corrected > 0 && (
                <Chip tone="warn">{report.corrected.toLocaleString()} corrected</Chip>
              )}
              <Chip>{report.duplicates.toLocaleString()} already present</Chip>
              {report.rejected > 0
                ? <Chip tone="warn">{report.rejected.toLocaleString()} rejected</Chip>
                : <Chip tone="pos">0 rejected</Chip>}
              <Chip>{report.parsed.toLocaleString()} parsed</Chip>
            </div>

            {report.mapping && Object.keys(report.mapping).length > 0 && (
              <p className="inline-note" style={{ marginTop: 10 }}>
                Column mapping: {Object.entries(report.mapping).map(([k, v]) => `${k} ← "${v}"`).join(', ')}
              </p>
            )}

            {report.issues.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <Notice>
                  <strong>{report.issues.length} issue{report.issues.length === 1 ? '' : 's'} reported.</strong>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {report.issues.slice(0, 8).map((issue, i) => <li key={i}>{issue}</li>)}
                  </ul>
                </Notice>
              </div>
            )}

            {report.added === 0 && report.corrected === 0 && report.duplicates > 0 && report.rejected === 0 && (
              <p className="inline-note" style={{ marginTop: 10 }}>
                Everything in this file was already stored. Re-syncing is always safe — draws are
                keyed by game, date and drawing, so nothing is ever duplicated.
              </p>
            )}
          </Card>
        </div>
      )}

      <div style={{ marginTop: 14 }} className="grid grid-2">
        <Card title="How syncing works">
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--muted)', display: 'grid', gap: 7 }}>
            <li>Downloads the Lottery's published history PDF for the game and parses every record.</li>
            <li>Each draw is validated against the game matrix <em>in effect on that draw date</em> — matrices have changed over the years, and old draws are checked against the old rules.</li>
            <li>Draws are keyed on game + date + drawing, so re-syncing never duplicates anything; later official corrections replace the older result.</li>
            <li>If the source layout ever changes, ingest fails loudly rather than importing bad data quietly.</li>
          </ul>
        </Card>

        <Card title="Importing your own file">
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--muted)', display: 'grid', gap: 7 }}>
            <li>CSV and Excel are both accepted. Column names are matched loosely — <code>Draw Date</code>, <code>date</code>, <code>Winning Numbers</code>, <code>N1..N5</code> all work.</li>
            <li>Numbers may sit in one delimited column or separate positional columns.</li>
            <li>Imported rows pass through exactly the same validation as official data.</li>
            <li>The detected column mapping is reported back so you can confirm it read your file correctly.</li>
          </ul>
        </Card>
      </div>

      <div style={{ marginTop: 14 }}>
        <Notice tone="neutral" icon="i">
          Results shown here are informational. In any discrepancy, the official records of the
          Florida Lottery are controlling — always verify a winning ticket against them.
        </Notice>
      </div>
    </>
  );
}
