import { cloneElement, useEffect, useId, useRef } from 'react';
import { Icon } from './Icon.jsx';

export function Button({ variant = 'primary', size = 'md', loading = false, icon, children, className = '', disabled, type = 'button', ...rest }) {
  return (
    <button type={type} className={`btn btn-${variant} btn-${size} ${className}`.trim()} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="spinner spinner-sm" aria-hidden="true" /> : icon ? <Icon name={icon} size={size === 'sm' ? 16 : 18} /> : null}
      {children}
    </button>
  );
}

export function IconButton({ icon, label, className = '', ...rest }) {
  return (
    <button type="button" className={`icon-btn ${className}`.trim()} aria-label={label} title={label} {...rest}>
      <Icon name={icon} size={18} />
    </button>
  );
}

export function Card({ title, subtitle, action, children, className = '', ...rest }) {
  const titleId = useId();
  return (
    <section className={`card ${className}`.trim()} aria-labelledby={title ? titleId : undefined} {...rest}>
      {(title || action) && (
        <header className="card-head">
          <div>
            {title && <h2 className="card-title" id={titleId}>{title}</h2>}
            {subtitle && <p className="card-sub">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="page-head">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}

export function Field({ label, error, hint, children, className = '' }) {
  const id = useId();
  const child = children && typeof children === 'object' && 'type' in children
    ? { ...children, props: { ...children.props, id, 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? `${id}-err` : hint ? `${id}-hint` : undefined } }
    : children;
  return (
    <div className={`field ${error ? 'has-error' : ''} ${className}`.trim()}>
      <label htmlFor={id}>{label}</label>
      {child}
      {hint && !error && <p className="field-hint" id={`${id}-hint`}>{hint}</p>}
      {error && <p className="field-error" id={`${id}-err`} role="alert">{error}</p>}
    </div>
  );
}

export function Spinner({ label = 'Loading' }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

export function LoadingBlock({ label = 'Loading…', rows = 3 }) {
  return (
    <div className="loading-block" role="status" aria-live="polite" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ width: `${100 - i * 12}%` }} />)}
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function PageLoading({ label }) {
  return <div className="page-loading"><Spinner label={label} /><p>{label ?? 'Loading…'}</p></div>;
}

export function ErrorState({ error, onRetry, title = 'Something went wrong' }) {
  return (
    <div className="state state-error" role="alert">
      <Icon name="alert" size={28} />
      <h3>{title}</h3>
      <p>{error?.message ?? 'Please try again.'}</p>
      {onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function EmptyState({ icon = 'info', title, children, action }) {
  return (
    <div className="state">
      <div className="state-icon"><Icon name={icon} size={26} /></div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Badge({ tone = 'neutral', children }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function ProgressBar({ percent, tone = 'accent', label, height }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className={`progress progress-${tone}`} style={height ? { height } : undefined} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamped)} aria-label={label}>
      <span style={{ width: `${clamped}%` }} />
    </div>
  );
}

export function Segmented({ value, onChange, options, label }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.icon && <Icon name={o.icon} size={16} />}{o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description, disabled }) {
  const id = useId();
  return (
    <div className="toggle-row">
      <div>
        <label htmlFor={id} className="toggle-label">{label}</label>
        {description && <p className="field-hint">{description}</p>}
      </div>
      <button id={id} type="button" role="switch" aria-checked={checked} disabled={disabled} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
        <span />
      </button>
    </div>
  );
}

export function MonthPicker({ month, onChange, label, max }) {
  const [y, m] = month.split('-').map(Number);
  const shift = (n) => {
    const t = y * 12 + (m - 1) + n;
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
  };
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return (
    <div className="month-picker" role="group" aria-label={label ?? 'Choose month'}>
      <IconButton icon="left" label="Previous month" onClick={() => onChange(shift(-1))} disabled={y <= 2000 && m === 1} />
      <span className="month-picker-label" aria-live="polite">{names[m - 1]} {y}</span>
      <IconButton icon="right" label="Next month" onClick={() => onChange(shift(1))} disabled={max ? shift(1) > max : false} />
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide = false, description }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement;
    const node = ref.current;
    const focusable = () => [...node.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
    (node.querySelector('[data-autofocus]') ?? focusable()[0] ?? node).focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab') {
        const items = focusable();
        if (!items.length) return;
        const first = items[0]; const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; previous?.focus?.(); };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1}>
        <header className="modal-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p className="card-sub">{description}</p>}
          </div>
          <IconButton icon="x" label="Close" onClick={onClose} />
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, message, confirmLabel = 'Delete', onConfirm, onClose, busy, variant = 'danger' }) {
  return (
    <Modal title={title} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button variant={variant} onClick={onConfirm} loading={busy} data-autofocus>{confirmLabel}</Button></>}>
      <p className="confirm-text">{message}</p>
    </Modal>
  );
}

export function FormError({ error }) {
  if (!error) return null;
  return <div className="form-error" role="alert"><Icon name="alert" size={18} /><span>{error}</span></div>;
}

export function ColorDot({ color, size = 10 }) {
  return <span className="dot" style={{ width: size, height: size, background: `var(--c-${color || 'slate'})` }} aria-hidden="true" />;
}

/** Compact labelled control for filter bars (label is associated by id, so its name excludes the options). */
export function FilterField({ label, children }) {
  const id = useId();
  return (
    <div className="ffield">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, { id })}
    </div>
  );
}
