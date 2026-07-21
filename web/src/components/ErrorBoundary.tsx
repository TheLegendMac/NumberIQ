import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * A render crash anywhere in the tree would otherwise unmount everything and
 * leave a blank page with the reason visible only in the console. This surfaces
 * it on screen instead — a blank screen is the hardest possible thing to debug.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[NumberIQ] Render error:', error, info.componentStack);
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div style={{ padding: 32, maxWidth: 720, margin: '0 auto', fontFamily: 'var(--font)' }}>
        <h1 style={{ marginBottom: 10 }}>NumberIQ hit a rendering error</h1>
        <p style={{ color: 'var(--muted)', marginBottom: 16 }}>
          The interface stopped rather than showing you a blank page. The details are below and in
          the browser console.
        </p>
        <pre
          style={{
            background: 'var(--surface-2)', border: '1px solid var(--border)',
            borderRadius: 10, padding: 14, fontSize: 12.5, overflow: 'auto',
            color: 'var(--neg)', whiteSpace: 'pre-wrap',
          }}
        >
          {error.message}
          {error.stack ? `\n\n${error.stack.split('\n').slice(1, 6).join('\n')}` : ''}
        </pre>
        <button
          className="btn btn-primary"
          style={{ marginTop: 16 }}
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    );
  }
}
