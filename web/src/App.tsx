import { useEffect, useState, lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type GameSummary } from './lib/api.js';
import { GeneratePage } from './features/generate/GeneratePage.js';
import { Skeleton, ErrorBox } from './components/ui.js';
import type { GameId } from '@numberiq/shared';

/**
 * Generate is the default route and stays in the main bundle so the primary task
 * is instant. The chart-heavy routes pull in Recharts, which is most of the
 * payload — they load on demand instead of taxing every first paint.
 */
const AnalyzePage = lazy(() => import('./features/analyze/AnalyzePage.js').then((m) => ({ default: m.AnalyzePage })));
const BacktestPage = lazy(() => import('./features/backtest/BacktestPage.js').then((m) => ({ default: m.BacktestPage })));
const TicketsPage = lazy(() => import('./features/track/TicketsPage.js').then((m) => ({ default: m.TicketsPage })));
const DataPage = lazy(() => import('./features/data/DataPage.js').then((m) => ({ default: m.DataPage })));

type Route = 'generate' | 'analyze' | 'backtest' | 'tickets' | 'data';

const NAV: Array<{ id: Route; label: string; icon: string }> = [
  { id: 'generate', label: 'Generate', icon: '◆' },
  { id: 'analyze', label: 'Analyze', icon: '▦' },
  { id: 'backtest', label: 'Backtest', icon: '⟲' },
  { id: 'tickets', label: 'Tickets', icon: '▤' },
  { id: 'data', label: 'Data', icon: '⛁' },
];

function useHashRoute(): [Route, (r: Route) => void] {
  const read = (): Route => {
    const h = window.location.hash.replace('#/', '') as Route;
    return NAV.some((n) => n.id === h) ? h : 'generate';
  };
  const [route, setRoute] = useState<Route>(read);
  useEffect(() => {
    const onHash = () => setRoute(read());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = (r: Route) => { window.location.hash = `#/${r}`; setRoute(r); };
  return [route, go];
}

export function App() {
  const [route, go] = useHashRoute();
  const [gameId, setGameId] = useState<GameId>('fantasy5');
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('numberiq-theme') as 'dark' | 'light') ?? 'dark',
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('numberiq-theme', theme);
  }, [theme]);

  const games = useQuery({ queryKey: ['games'], queryFn: api.games, staleTime: 5 * 60_000 });

  const game: GameSummary | undefined = games.data?.find((g) => g.id === gameId);

  return (
    <div className="shell">
      <nav className="rail" aria-label="Main">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">IQ</span>
          <div>
            NumberIQ
            <div className="brand-sub">Florida · Local</div>
          </div>
        </div>
        {NAV.map((n) => (
          <button
            key={n.id}
            className="nav-item"
            aria-current={route === n.id ? 'page' : undefined}
            onClick={() => go(n.id)}
          >
            <span className="nav-icon" aria-hidden="true">{n.icon}</span>
            {n.label}
          </button>
        ))}
        <div className="spacer" />
        <button
          className="nav-item nav-theme"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          <span className="nav-icon" aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>
      </nav>

      <main className="main">
        <div className="content">
          {games.isLoading && <Skeleton rows={4} />}
          {games.isError && <ErrorBox error={games.error} />}
          {games.data && (
            <Suspense fallback={<Skeleton rows={5} />}>
              {route === 'generate' && <GeneratePage games={games.data} gameId={gameId} setGameId={setGameId} />}
              {route === 'analyze' && <AnalyzePage games={games.data} gameId={gameId} setGameId={setGameId} />}
              {route === 'backtest' && <BacktestPage games={games.data} gameId={gameId} setGameId={setGameId} />}
              {route === 'tickets' && <TicketsPage games={games.data} />}
              {route === 'data' && <DataPage games={games.data} />}
            </Suspense>
          )}
        </div>

        <footer className="site-footer">
          <span>
            Informational only. Official Florida Lottery records are controlling.
            Personal use. 18+.
          </span>
          <span>
            Lottery play is gambling, not investing. Help: <strong>1-800-GAMBLER</strong>
            {game && ` · ${game.name}`}
          </span>
        </footer>
      </main>
    </div>
  );
}
