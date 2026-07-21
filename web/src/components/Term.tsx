import { useState, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { GLOSSARY } from '../lib/glossary.js';

/**
 * Inline glossary term. Hovering, focusing or tapping reveals a plain-language
 * explanation without navigating away — so a statistic can stay on screen at full
 * fidelity while remaining readable to someone who has never met the term.
 *
 * Keyboard and touch accessible: it is a real <button>, not a hover-only affordance.
 */
export function Term({ id, children }: { id: keyof typeof GLOSSARY; children?: ReactNode }) {
  const entry = GLOSSARY[id];
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLButtonElement>(null);

  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    // Keep the tip on screen on narrow viewports.
    const x = Math.min(Math.max(r.left + r.width / 2, 150), window.innerWidth - 150);
    setPos({ x, y: r.bottom + 8 });
  };
  const hide = () => setPos(null);

  if (!entry) return <>{children}</>;

  return (
    <>
      <button
        ref={ref}
        type="button"
        className="term"
        style={{ background: 'none', border: 'none', borderBottom: '1px dashed var(--muted-2)', padding: 0, font: 'inherit', cursor: 'help' }}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => { e.preventDefault(); pos ? hide() : show(); }}
        aria-label={`${entry.term}: ${entry.plain}`}
      >
        {children ?? entry.term}
      </button>

      {pos &&
        createPortal(
          <span
            className="tip"
            role="tooltip"
            style={{ left: pos.x, top: pos.y, transform: 'translateX(-50%)' }}
          >
            <span className="tip-term">{entry.term}</span>
            {entry.plain}
          </span>,
          document.body,
        )}
    </>
  );
}

/**
 * A statistic presented as a plain-language reading first, with the raw figure
 * kept directly beneath it. Depth is never removed — only led.
 */
export function Reading({ plain, technical, tone = 'neutral' }: {
  plain: ReactNode;
  technical?: ReactNode;
  tone?: 'pos' | 'warn' | 'neg' | 'neutral';
}) {
  const color =
    tone === 'pos' ? 'var(--pos)' : tone === 'warn' ? 'var(--warn)' : tone === 'neg' ? 'var(--neg)' : 'var(--muted-2)';
  return (
    <div className="reading">
      <span className="reading-dot" style={{ background: color }} aria-hidden="true" />
      <div className="reading-main">
        <div className="reading-plain">{plain}</div>
        {technical && <div className="reading-tech">{technical}</div>}
      </div>
    </div>
  );
}
