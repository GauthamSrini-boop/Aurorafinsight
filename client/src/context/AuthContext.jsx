import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setUnauthorizedHandler } from '../lib/api.js';
import { formatMoney } from '../lib/money.js';
import { todayIn } from '../lib/dates.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

const systemDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
const resolveTheme = (t) => (t === 'light' ? 'light' : t === 'dark' ? 'dark' : systemDark() ? 'dark' : 'light');

export function applyTheme(theme) {
  document.documentElement.dataset.theme = resolveTheme(theme);
  document.documentElement.style.colorScheme = resolveTheme(theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolveTheme(theme) === 'dark' ? '#0b1020' : '#f4f6fb');
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | authed | anon
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    try { applyTheme(localStorage.getItem('aurora.theme') || 'system'); } catch { applyTheme('system'); }
    setUnauthorizedHandler(() => { setUser(null); setStatus('anon'); setSessionExpired(true); });
    api.get('/auth/me').then((r) => { setUser(r.user); setStatus('authed'); }).catch(() => setStatus('anon'));
  }, []);

  // Keep the theme in sync with the saved preference (and the OS when set to "system").
  useEffect(() => {
    const theme = user?.theme ?? (() => { try { return localStorage.getItem('aurora.theme') || 'system'; } catch { return 'system'; } })();
    applyTheme(theme);
    try { localStorage.setItem('aurora.theme', theme); } catch { /* storage unavailable: fine */ }
    if (theme !== 'system') return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => applyTheme('system');
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [user?.theme]);

  const login = useCallback(async (email, password) => {
    const r = await api.post('/auth/login', { email, password });
    setSessionExpired(false); setUser(r.user); setStatus('authed');
  }, []);
  const register = useCallback(async (name, email, password) => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const r = await api.post('/auth/register', { name, email, password, ...(timezone ? { timezone } : {}) });
    setSessionExpired(false); setUser(r.user); setStatus('authed');
  }, []);
  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } finally { setUser(null); setStatus('anon'); }
  }, []);
  const clear = useCallback(() => { setUser(null); setStatus('anon'); }, []);

  const value = useMemo(() => ({
    user, status, sessionExpired, login, register, logout, setUser, clear,
    currency: user?.currency ?? 'INR',
    money: (minor, opts) => formatMoney(minor, user?.currency ?? 'INR', opts),
    today: user ? todayIn(user.timezone) : todayIn('UTC'),
  }), [user, status, sessionExpired, login, register, logout, clear]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
