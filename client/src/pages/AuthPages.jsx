import { useState } from 'react';
import { Link } from '../lib/router.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { Button, Field, FormError } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { Brand } from '../components/AppShell.jsx';

function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="auth">
      <aside className="auth-hero" aria-hidden="true">
        <Brand />
        <div>
          <h2>Know where every rupee goes.</h2>
          <p>Track spending, set budgets, reach savings goals — and get honest, explainable suggestions from your own history.</p>
          <ul>
            <li><Icon name="shield" size={18} /> Your data stays private to your account</li>
            <li><Icon name="chart" size={18} /> Every figure computed from your real records</li>
            <li><Icon name="sparkles" size={18} /> Suggestions that show their working</li>
          </ul>
        </div>
      </aside>
      <main className="auth-panel" id="main">
        <div className="auth-card">
          <div className="auth-brand-mobile"><Brand /></div>
          <h1>{title}</h1>
          <p className="page-sub">{subtitle}</p>
          {children}
          <p className="auth-foot">{footer}</p>
        </div>
      </main>
    </div>
  );
}

function PasswordInput({ value, onChange, autoComplete, id, ...rest }) {
  const [show, setShow] = useState(false);
  return (
    <div className="input-wrap">
      <input id={id} type={show ? 'text' : 'password'} value={value} onChange={onChange} autoComplete={autoComplete} {...rest} />
      <button type="button" className="icon-btn input-btn" aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show} onClick={() => setShow((s) => !s)}><Icon name={show ? 'eyeOff' : 'eye'} size={18} /></button>
    </div>
  );
}
export { PasswordInput };

export function LoginPage() {
  const { login, sessionExpired } = useAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!form.email.trim()) next.email = 'Enter your email.';
    if (!form.password) next.password = 'Enter your password.';
    setErrors(next); setFormError('');
    if (Object.keys(next).length) return;
    setBusy(true);
    try { await login(form.email.trim(), form.password); } catch (err) {
      setBusy(false);
      if (err.fields && Object.keys(err.fields).length) setErrors(err.fields); else setFormError(err.message);
    }
  };

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to continue to your dashboard." footer={<>New here? <Link to="/register">Create an account</Link></>}>
      {sessionExpired && <div className="form-error info" role="status"><Icon name="info" size={18} /><span>Your session ended. Please sign in again.</span></div>}
      <form onSubmit={submit} noValidate className="form">
        <Field label="Email" error={errors.email}><input type="email" autoComplete="email" value={form.email} onChange={set('email')} data-autofocus autoFocus /></Field>
        <Field label="Password" error={errors.password}><PasswordInput autoComplete="current-password" value={form.password} onChange={set('password')} /></Field>
        <FormError error={formError} />
        <Button type="submit" loading={busy} className="btn-block">Sign in</Button>
      </form>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!form.name.trim()) next.name = 'Enter your name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) next.email = 'Enter a valid email address.';
    if (form.password.length < 8) next.password = 'Use at least 8 characters.';
    else if (!/[A-Za-z]/.test(form.password) || !/\d/.test(form.password)) next.password = 'Include at least one letter and one number.';
    setErrors(next); setFormError('');
    if (Object.keys(next).length) return;
    setBusy(true);
    try { await register(form.name.trim(), form.email.trim(), form.password); } catch (err) {
      setBusy(false);
      if (err.fields && Object.keys(err.fields).length) setErrors(err.fields); else setFormError(err.message);
    }
  };

  return (
    <AuthLayout title="Create your account" subtitle="Start tracking your money in a minute." footer={<>Already have an account? <Link to="/login">Sign in</Link></>}>
      <form onSubmit={submit} noValidate className="form">
        <Field label="Name" error={errors.name}><input autoComplete="name" value={form.name} onChange={set('name')} maxLength={80} autoFocus /></Field>
        <Field label="Email" error={errors.email}><input type="email" autoComplete="email" value={form.email} onChange={set('email')} /></Field>
        <Field label="Password" error={errors.password} hint="At least 8 characters with a letter and a number."><PasswordInput autoComplete="new-password" value={form.password} onChange={set('password')} /></Field>
        <FormError error={formError} />
        <Button type="submit" loading={busy} className="btn-block">Create account</Button>
      </form>
    </AuthLayout>
  );
}
