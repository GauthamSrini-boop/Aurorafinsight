import { useEffect, useRef, useState } from 'react';
import { NavLink, useRouter } from '../lib/router.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import { Icon } from './Icon.jsx';

export const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { to: '/transactions', label: 'Transactions', icon: 'list' },
  { to: '/analytics', label: 'Analytics', icon: 'chart' },
  { to: '/budgets', label: 'Budgets', icon: 'wallet' },
  { to: '/goals', label: 'Savings Goals', icon: 'target' },
  { to: '/smartsave', label: 'SmartSave', icon: 'sparkles' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true"><Icon name="chart" size={18} strokeWidth="2.4" /></span>
      <span className="brand-name">Aurora <b>FinSight</b></span>
    </div>
  );
}

export function AppShell({ children }) {
  const { user, logout, setUser } = useAuth();
  const toast = useToast();
  const { path } = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuBtn = useRef(null);
  const sidebar = useRef(null);

  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); menuBtn.current?.focus(); } };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    sidebar.current?.querySelector('a')?.focus();
    return () => { document.removeEventListener('keydown', onKey); document.body.classList.remove('no-scroll'); };
  }, [open]);

  const current = NAV.find((n) => path === n.to || path.startsWith(`${n.to}/`));
  useEffect(() => { document.title = `${current?.label ?? 'Not found'} · Aurora FinSight`; }, [current]);

  const isDark = document.documentElement.dataset.theme !== 'light';
  const toggleTheme = async () => {
    try { const r = await api.patch('/profile', { theme: isDark ? 'light' : 'dark' }); setUser(r.user); } catch (e) { toast.error(e.message); }
  };
  const signOut = async () => {
    setSigningOut(true);
    try { await logout(); } catch (e) { toast.error(e.message); setSigningOut(false); }
  };
  const initials = user.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="topbar">
        <button ref={menuBtn} type="button" className="icon-btn" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} aria-controls="sidebar" onClick={() => setOpen((o) => !o)}>
          <Icon name={open ? 'x' : 'menu'} />
        </button>
        <Brand />
        <button type="button" className="icon-btn" aria-label={`Switch to ${isDark ? 'light' : 'dark'} theme`} onClick={toggleTheme}><Icon name={isDark ? 'sun' : 'moon'} /></button>
      </header>
      {open && <div className="scrim" onClick={() => setOpen(false)} aria-hidden="true" />}
      <aside id="sidebar" ref={sidebar} className={`sidebar ${open ? 'open' : ''}`} aria-label="Sidebar">
        <div className="sidebar-brand"><Brand /></div>
        <nav aria-label="Primary">
          <ul>
            {NAV.map((n) => (
              <li key={n.to}><NavLink to={n.to} className="nav-link"><Icon name={n.icon} size={19} /><span>{n.label}</span></NavLink></li>
            ))}
          </ul>
        </nav>
        <div className="sidebar-foot">
          <div className="user-chip">
            <span className="avatar" aria-hidden="true">{initials}</span>
            <div><strong>{user.name}</strong><span>{user.email}</span></div>
          </div>
          <div className="sidebar-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={toggleTheme}><Icon name={isDark ? 'sun' : 'moon'} size={16} />{isDark ? 'Light' : 'Dark'}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={signOut} disabled={signingOut}><Icon name="logout" size={16} />Sign out</button>
          </div>
        </div>
      </aside>
      <main id="main" className="main" tabIndex={-1}>{children}</main>
    </div>
  );
}
