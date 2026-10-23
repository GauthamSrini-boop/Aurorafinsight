import { useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import { useApi } from '../lib/useApi.js';
import { CURRENCIES, minorToInput, parseSignedAmount } from '../lib/money.js';
import { Badge, Button, Card, ColorDot, ConfirmDialog, ErrorState, Field, FormError, IconButton, LoadingBlock, Modal, PageHeader, Segmented, Toggle } from '../components/ui.jsx';
import { PasswordInput } from './AuthPages.jsx';

const COLORS = ['indigo', 'cyan', 'emerald', 'amber', 'rose', 'violet', 'sky', 'orange', 'slate'];
const FALLBACK_TZ = ['UTC', 'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Australia/Sydney'];

function Section({ title, subtitle, children }) {
  return <Card title={title} subtitle={subtitle} className="settings-card">{children}</Card>;
}

function ProfileSection() {
  const { user, setUser, currency } = useAuth();
  const toast = useToast();
  const zones = useMemo(() => {
    let list = FALLBACK_TZ;
    try { list = Intl.supportedValuesOf('timeZone'); } catch { /* use fallback */ }
    return list.includes(user.timezone) ? list : [user.timezone, ...list];
  }, [user.timezone]);
  const [name, setName] = useState(user.name);
  const [timezone, setTimezone] = useState(user.timezone);
  const initialOpening = user.openingBalanceMinor ? minorToInput(user.openingBalanceMinor) : '';
  const [opening, setOpening] = useState(initialOpening);
  const [openingError, setOpeningError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const parsedOpening = parseSignedAmount(opening);
  // An invalid entry still counts as a change, so pressing Save shows the error instead of a dead button.
  const dirty = name.trim() !== user.name || timezone !== user.timezone || opening.trim() !== initialOpening.trim();

  const save = async (e) => {
    e.preventDefault();
    if (!name.trim()) { setError('Name is required.'); return; }
    if (parsedOpening.error) { setOpeningError(parsedOpening.error); return; }
    setBusy(true); setError(''); setOpeningError('');
    try { const r = await api.patch('/profile', { name: name.trim(), timezone, openingBalanceMinor: parsedOpening.minor }); setUser(r.user); toast.success('Profile saved.'); } catch (err) { setError(err.fields?.name ?? err.message); }
    setBusy(false);
  };
  return (
    <Section title="Profile" subtitle="How you appear in the app and which day counts as “today”.">
      <form className="form" onSubmit={save} noValidate>
        <div className="grid-2">
          <Field label="Name" error={error}><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Email" hint="Your sign-in email can’t be changed here."><input value={user.email} readOnly disabled /></Field>
        </div>
        <Field label="Time zone" hint="Used to decide what “today” is, so future-dated entries are blocked correctly.">
          <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>{zones.map((z) => <option key={z}>{z}</option>)}</select>
        </Field>
        <Field label={`Opening balance (${currency})`} error={openingError} hint="What you had before your first transaction. Your total balance is this plus income minus expenses. Use a minus sign if you started overdrawn.">
          <input inputMode="decimal" placeholder="0.00" value={opening} onChange={(e) => setOpening(e.target.value)} />
        </Field>
        <div className="form-actions"><Button type="submit" loading={busy} disabled={!dirty}>Save profile</Button></div>
      </form>
    </Section>
  );
}

function PreferencesSection() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const update = async (patch, okMessage) => {
    setBusy(true);
    try { const r = await api.patch('/profile', patch); setUser(r.user); if (okMessage) toast.success(okMessage); } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  return (
    <>
      <Section title="Appearance" subtitle="Choose how Aurora FinSight looks.">
        <Segmented label="Theme" value={user.theme} onChange={(theme) => update({ theme }, 'Theme updated.')}
          options={[{ value: 'dark', label: 'Dark', icon: 'moon' }, { value: 'light', label: 'Light', icon: 'sun' }, { value: 'system', label: 'System', icon: 'settings' }]} />
      </Section>
      <Section title="Currency" subtitle="Controls how amounts are displayed.">
        <Field label="Display currency" hint="Display only — existing amounts are not converted. Pick the currency you actually track your money in.">
          <select value={user.currency} disabled={busy} onChange={(e) => update({ currency: e.target.value }, 'Currency updated.')}>{CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}</select>
        </Field>
      </Section>
      <Section title="Notifications" subtitle="In-app alerts shown while you use the app.">
        <Toggle label="Budget alerts" description="Warn me when a budget reaches 80%, its limit, or is exceeded." checked={user.notifications.budget} disabled={busy} onChange={(v) => update({ notifications: { budget: v } })} />
        <Toggle label="Goal updates" description="Celebrate when a savings goal is completed." checked={user.notifications.goals} disabled={busy} onChange={(v) => update({ notifications: { goals: v } })} />
        <Toggle label="SmartSave tips" description="Allow SmartSave suggestions to be shown." checked={user.notifications.tips} disabled={busy} onChange={(v) => update({ notifications: { tips: v } })} />
      </Section>
    </>
  );
}

function CategoryModal({ category, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: category?.name ?? '', kind: category?.kind ?? 'expense', color: category?.color ?? 'slate', flexible: category?.flexible ?? false });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required.'); return; }
    setBusy(true); setError('');
    try {
      if (category) await api.patch(`/categories/${category.id}`, { name: form.name.trim(), color: form.color, flexible: form.flexible });
      else await api.post('/categories', { name: form.name.trim(), kind: form.kind, color: form.color, flexible: form.kind === 'expense' && form.flexible });
      toast.success('Category saved.'); onSaved();
    } catch (err) { setBusy(false); setError(err.fields?.name ?? err.message); }
  };
  return (
    <Modal title={category ? 'Edit category' : 'New category'} onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        {!category && <Segmented label="Kind" value={form.kind} onChange={(kind) => setForm((f) => ({ ...f, kind }))} options={[{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }]} />}
        <Field label="Name" error={error}><input maxLength={40} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} data-autofocus /></Field>
        <div className="field"><span className="label">Colour</span>
          <div className="swatches" role="radiogroup" aria-label="Colour">
            {COLORS.map((c) => <button key={c} type="button" role="radio" aria-checked={form.color === c} aria-label={c} className={form.color === c ? 'on' : ''} style={{ background: `var(--c-${c})` }} onClick={() => setForm((f) => ({ ...f, color: c }))} />)}
          </div></div>
        {(category ? category.kind : form.kind) === 'expense' && <Toggle label="Flexible spending" description="Discretionary — SmartSave may suggest trimming it." checked={form.flexible} onChange={(flexible) => setForm((f) => ({ ...f, flexible }))} />}
        <div className="form-actions"><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" loading={busy}>Save</Button></div>
      </form>
    </Modal>
  );
}

function CategoriesSection() {
  const toast = useToast();
  const { data, error, loading, reload } = useApi(() => api.get('/categories'), []);
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    try { await api.delete(`/categories/${modal.category.id}`); toast.success('Category deleted.'); setModal(null); reload({ silent: true }); }
    catch (e) { toast.error(e.code === 'category_in_use' ? 'This category has transactions. Move or delete them first.' : e.message); setModal(null); }
    setBusy(false);
  };
  return (
    <Section title="Categories" subtitle="Organise your transactions your way.">
      {loading && !data && <LoadingBlock rows={3} />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data && ['expense', 'income'].map((kind) => (
        <div key={kind} className="cat-group">
          <h3 className="subhead">{kind === 'expense' ? 'Expense categories' : 'Income categories'}</h3>
          <ul className="cat-list">
            {data.categories.filter((c) => c.kind === kind).map((c) => (
              <li key={c.id}>
                <ColorDot color={c.color} size={12} /><span className="cat-name">{c.name}</span>
                {c.flexible && <Badge tone="neutral">flexible</Badge>}<small className="muted">{c.usageCount} txn{c.usageCount === 1 ? '' : 's'}</small>
                <span className="row-actions"><IconButton icon="edit" label={`Edit ${c.name}`} onClick={() => setModal({ type: 'edit', category: c })} /><IconButton icon="trash" label={`Delete ${c.name}`} onClick={() => setModal({ type: 'delete', category: c })} /></span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <Button variant="secondary" icon="plus" onClick={() => setModal({ type: 'edit' })}>Add category</Button>
      {modal?.type === 'edit' && <CategoryModal category={modal.category} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload({ silent: true }); }} />}
      {modal?.type === 'delete' && <ConfirmDialog title="Delete category?" busy={busy} onClose={() => setModal(null)} onConfirm={remove} message={`“${modal.category.name}” will be removed. Categories that still have transactions can’t be deleted.`} />}
    </Section>
  );
}

function SecuritySection() {
  const toast = useToast();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!form.currentPassword) next.currentPassword = 'Enter your current password.';
    if (form.newPassword.length < 8) next.newPassword = 'Use at least 8 characters.';
    else if (!/[A-Za-z]/.test(form.newPassword) || !/\d/.test(form.newPassword)) next.newPassword = 'Include at least one letter and one number.';
    if (form.confirm !== form.newPassword) next.confirm = 'Passwords do not match.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      await api.post('/profile/password', { currentPassword: form.currentPassword, newPassword: form.newPassword });
      toast.success('Password changed. Other devices have been signed out.');
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
    } catch (err) { setErrors(err.fields && Object.keys(err.fields).length ? err.fields : { currentPassword: err.message }); }
    setBusy(false);
  };
  return (
    <Section title="Password" subtitle="Changing it signs you out everywhere else.">
      <form className="form" onSubmit={submit} noValidate>
        <Field label="Current password" error={errors.currentPassword}><PasswordInput autoComplete="current-password" value={form.currentPassword} onChange={set('currentPassword')} /></Field>
        <div className="grid-2">
          <Field label="New password" error={errors.newPassword}><PasswordInput autoComplete="new-password" value={form.newPassword} onChange={set('newPassword')} /></Field>
          <Field label="Confirm new password" error={errors.confirm}><PasswordInput autoComplete="new-password" value={form.confirm} onChange={set('confirm')} /></Field>
        </div>
        <div className="form-actions"><Button type="submit" loading={busy}>Change password</Button></div>
      </form>
    </Section>
  );
}

function DataSection() {
  const { clear } = useAuth();
  const toast = useToast();
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const exportData = async () => {
    setExporting(true);
    try {
      const res = await api.download('/profile/export');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url; a.download = 'aurora-finsight-export.json'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('Export downloaded.');
    } catch (e) { toast.error(e.message); }
    setExporting(false);
  };
  const deleteAccount = async (e) => {
    e.preventDefault();
    if (!password) { setError('Enter your password to confirm.'); return; }
    setBusy(true); setError('');
    try { await api.delete('/profile', { password }); clear(); } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Section title="Your data" subtitle="Download everything we store about you, or delete your account.">
      <div className="row wrap">
        <Button variant="secondary" icon="download" onClick={exportData} loading={exporting}>Export my data (JSON)</Button>
        <Button variant="danger" icon="trash" onClick={() => { setDeleting(true); setPassword(''); setError(''); }}>Delete account</Button>
      </div>
      {deleting && (
        <Modal title="Delete your account?" onClose={() => setDeleting(false)} description="This permanently deletes your profile, transactions, budgets and goals. It cannot be undone.">
          <form className="form" onSubmit={deleteAccount} noValidate>
            <Field label="Confirm with your password" error={error}><PasswordInput autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} data-autofocus /></Field>
            <FormError error="" />
            <div className="form-actions"><Button variant="ghost" onClick={() => setDeleting(false)} disabled={busy}>Cancel</Button><Button type="submit" variant="danger" loading={busy}>Delete everything</Button></div>
          </form>
        </Modal>
      )}
    </Section>
  );
}

export function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" subtitle="Profile, appearance, notifications and security." />
      <div className="settings-grid">
        <div className="stack"><ProfileSection /><PreferencesSection /></div>
        <div className="stack"><CategoriesSection /><SecuritySection /><DataSection /></div>
      </div>
    </>
  );
}
