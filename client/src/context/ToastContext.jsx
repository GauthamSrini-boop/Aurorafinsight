import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon.jsx';

const ToastContext = createContext(null);
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((level, message) => {
    if (!message) return;
    const id = nextId.current++;
    setToasts((list) => [...list.slice(-3), { id, level, message }]);
    timers.current.set(id, setTimeout(() => dismiss(id), level === 'error' ? 8000 : 5000));
  }, [dismiss]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const api = useMemo(() => ({
    push,
    success: (m) => push('success', m),
    error: (m) => push('error', m),
    info: (m) => push('info', m),
    warning: (m) => push('warning', m),
    /** Show server-sent budget alerts / goal notifications ({ level, message }). */
    fromServer: (items) => (Array.isArray(items) ? items : [items]).filter(Boolean).forEach((a) => push(a.level === 'exceeded' ? 'error' : a.level === 'reached' ? 'warning' : a.level ?? 'info', a.message)),
  }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="region" aria-label="Notifications" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.level}`} role={t.level === 'error' ? 'alert' : 'status'}>
            <Icon name={t.level === 'success' ? 'check' : t.level === 'info' ? 'info' : 'alert'} size={18} />
            <span>{t.message}</span>
            <button type="button" className="icon-btn" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}><Icon name="x" size={16} /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
