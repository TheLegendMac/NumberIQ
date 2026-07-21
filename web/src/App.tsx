import { useEffect, useState, lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type GameSummary } from './lib/api.js';
import { TodayPage } from './features/today/TodayPage.js';
import { Skeleton, ErrorBox } from './components/ui.js';
import type { GameId } from '@numberiq/shared';

/**
 * Today is the default route and stays in the main bundle so the daily question —
 * what drew, did it hit, what is next — is answered on first paint. The
 * chart-heavy routes pull in Recharts, which is most of the payload; they load on
 * demand instead of taxing every visit.
 */
const GeneratePage = lazy(() => import('./features/generate/GeneratePage.js').then((m) => ({ default: m.GeneratePage })));
const AnalyzePage = lazy(() => import('./features/analyze/AnalyzePage.js').then((m) => ({ default: m.AnalyzePage })));
const BacktestPage = lazy(() => import('./features/backtest/BacktestPage.js').then((m) => ({ default: m.BacktestPage })));
const TicketsPage = lazy(() => import('./features/track/TicketsPage.js').then((m) => ({ default: m.TicketsPage })));
const DataPage = lazy(() => import('./features/data/DataPage.js').then((m) => ({ default: m.DataPage })));

type Route = 'today' | 'generate' | 'analyze' | 'backtest' | 'tickets' | 'data';

const NAV: Array<{ id: Route; label: string; icon: string }> = [
  { id: 'today', label: 'Today', icon: '☉' },
  { id: 'generate', label: 'Generate', icon: '◆' },
  { id: 'analyze', label: 'Analyze', icon: '▦' },
  { id: 'backtest', label: 'Backtest', icon: '⟲' },
  { id: 'tickets', label: 'Tickets', icon: '▤' },
  { id: 'data', label: 'Data', icon: '⛁' },
];

function useHashRoute(): [Route, (r: Route) => void] {
  const read = (): Route => {
    const h = window.location.hash.replace('#/', '') as Route;
    return NAV.some((n) => n.id === h) ? h : 'today';
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
  // Follow the OS on first run; an explicit toggle is remembered thereafter.
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('numberiq-theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('numberiq-theme', theme);
  }, [theme]);

  // Keyboard shortcuts: 1-5 jump between sections, G generates.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;

      const index = Number(e.key);
      if (index >= 1 && index <= NAV.length) {
        go(NAV[index - 1]!.id);
        return;
      }
      if (e.key.toLowerCase() === 'g' && route !== 'generate') go('generate');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [route]);

  const games = useQuery({ queryKey: ['games'], queryFn: api.games, staleTime: 5 * 60_000 });

  const game: GameSummary | undefined = games.data?.find((g) => g.id === gameId);

  return (
    <div className="shell">
      <nav className="rail" aria-label="Main">
        <button className="brand" onClick={() => go('today')} aria-label="NumberIQ — go to Today">
          <span className="brand-mark" aria-hidden="true">IQ</span>
          <span className="brand-text">
            NumberIQ
            <span className="brand-sub">Florida Lottery</span>
          </span>
        </button>
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
              {route === 'today' && <TodayPage games={games.data} go={(r) => go(r as Route)} />}
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
