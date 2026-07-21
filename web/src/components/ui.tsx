import {
  cloneElement, isValidElement, useId, useRef, useState,
  type ReactNode, type SelectHTMLAttributes, type ButtonHTMLAttributes, type InputHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

/**
 * A one-line summary that expands on demand. Used to keep required disclosures
 * permanently present (never dismissible) while stopping them from pushing the
 * actual result below the fold.
 */
export function Fold({ summary, children, defaultOpen = false, tone }: {
  summary: ReactNode; children: ReactNode; defaultOpen?: boolean; tone?: 'warn';
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <div className="fold" data-open={open}>
      <button
        type="button"
        className="fold-head"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={bodyId}
      >
        {tone === 'warn' && <span style={{ color: 'var(--warn)', fontWeight: 700 }} aria-hidden="true">!</span>}
        <span style={{ flex: 1 }}>{summary}</span>
        <span className="fold-caret" aria-hidden="true">▾</span>
      </button>
      {open && <div className="fold-body" id={bodyId}>{children}</div>}
    </div>
  );
}

export function Card({ title, sub, actions, children, className = '' }: {
  title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {sub && <p className="card-sub">{sub}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Button({ variant = 'default', size, className = '', type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'danger'; size?: 'sm' | 'lg';
}) {
  const v = variant === 'default' ? '' : `btn-${variant}`;
  return <button type={type} className={`btn ${v} ${size ? `btn-${size}` : ''} ${className}`} {...rest} />;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  const generatedId = useId();
  const hintId = `${generatedId}-hint`;
  const controlId = isValidElement<{ id?: string }>(children) ? (children.props.id ?? generatedId) : generatedId;
  const control = isValidElement<{ id?: string; 'aria-describedby'?: string }>(children)
    ? cloneElement(children, {
        id: controlId,
        'aria-describedby': hint
          ? [children.props['aria-describedby'], hintId].filter(Boolean).join(' ')
          : children.props['aria-describedby'],
      })
    : children;
  return (
    <div className="field">
      <label className="field-label" htmlFor={controlId}>{label}</label>
      {control}
      {hint && <span className="inline-note" id={hintId}>{hint}</span>}
    </div>
  );
}

export function Select({ className = '', ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`input ${className}`} {...rest} />;
}

export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`input ${className}`} {...rest} />;
}

export function Chip({ tone = 'default', children }: {
  tone?: 'default' | 'accent' | 'pos' | 'neg' | 'warn'; children: ReactNode;
}) {
  return <span className={`chip ${tone === 'default' ? '' : `chip-${tone}`}`}>{children}</span>;
}

/**
 * Disclosure component. Deliberately non-dismissible: the honesty requirements in
 * the Phase 1 audit depend on these being permanently visible, not closable.
 */
export function Notice({ tone = 'warn', icon = '!', children }: {
  tone?: 'warn' | 'neutral'; icon?: string; children: ReactNode;
}) {
  return (
    <div className={`notice ${tone === 'neutral' ? 'notice-neutral' : ''}`} role="note">
      <span className="notice-icon" aria-hidden="true">{icon}</span>
      <div>{children}</div>
    </div>
  );
}

export function Stat({ label, value, hint, tone, large }: {
  label: string; value: ReactNode; hint?: ReactNode; tone?: 'pos' | 'neg'; large?: boolean;
}) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${large ? 'lg' : ''} ${tone ?? ''}`}>{value}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

export function Ball({ n, kind = 'main', size, title }: {
  n: number; kind?: 'main' | 'extra' | 'digit'; size?: 'sm'; title?: string;
}) {
  const cls = kind === 'extra' ? 'ball-extra' : kind === 'digit' ? 'ball-digit' : '';
  return (
    <span className={`ball ${cls} ${size === 'sm' ? 'ball-sm' : ''}`} title={title}>
      {n}
    </span>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div style={{ display: 'grid', gap: 8 }} aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ width: `${100 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, active, onChange }: {
  tabs: Array<{ id: T; label: string }>; active: T; onChange: (id: T) => void;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    const tab = tabs[next];
    if (!tab) return;
    onChange(tab.id);
    refs.current[next]?.focus();
  };

  return (
    <div className="tabs" role="tablist" aria-label="Analysis views">
      {tabs.map((t, index) => (
        <button
          key={t.id}
          ref={(element) => { refs.current[index] = element; }}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          tabIndex={active === t.id ? 0 : -1}
          className="tab"
          onClick={() => onChange(t.id)}
          onKeyDown={(event) => move(event, index)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Meter({ value, tone, label }: { value: number; tone?: string; label?: string }) {
  const bounded = Math.max(0, Math.min(100, value));
  return (
    <div
      className="meter"
      role={label ? 'progressbar' : 'presentation'}
      aria-label={label}
      aria-valuemin={label ? 0 : undefined}
      aria-valuemax={label ? 100 : undefined}
      aria-valuenow={label ? Math.round(bounded) : undefined}
    >
      <div className="meter-fill" style={{ width: `${bounded}%`, background: tone }} />
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="notice" role="alert">
      <span className="notice-icon" aria-hidden="true">!</span>
      <div><strong>Something went wrong.</strong> {message}</div>
    </div>
  );
}
