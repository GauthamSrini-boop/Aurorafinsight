import { useState } from 'react';
import { useToast } from '../context/ToastContext.jsx';
import { minorToInput, parseAmount, parseOptionalAmount } from '../lib/money.js';
import { Field, FormError } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';
import { useApi } from '../lib/useApi.js';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingBlock, PageHeader, ProgressBar } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { Link } from '../lib/router.jsx';
import { formatDate } from '../lib/dates.js';

const TYPE_ICON = { category_overspend: 'alert', trim_flexible: 'down', small_frequent: 'coins', recurring_charge: 'history', weekend_spike: 'calendar', low_savings_rate: 'wallet', goal_impact: 'target' };
const CONF = { high: 'success', medium: 'warning', low: 'neutral' };

function Suggestion({ s, money }) {
  const [open, setOpen] = useState(false);
  return (
    <article className="suggestion">
      <div className="suggestion-icon"><Icon name={TYPE_ICON[s.type] ?? 'sparkles'} size={20} /></div>
      <div className="suggestion-body">
        <div className="split"><h3>{s.title}</h3><Badge tone={CONF[s.confidence]}>{s.confidence} confidence</Badge></div>
        <p>{s.summary}</p>
        {s.monthlyImpactMinor > 0 && <p className="impact">Potential: <b>{money(s.monthlyImpactMinor)}</b> / month</p>}
        <button type="button" className="link-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'Why am I seeing this?'}</button>
        {open && (
          <div className="why">
            <h4>Based on your data</h4>
            <ul>{s.evidence.map((e) => <li key={e}>{e}</li>)}</ul>
            {s.records?.length > 0 && (
              <>
                <h4>Transactions behind it</h4>
                <ul className="records">{s.records.map((r) => <li key={r.id}><span>{r.title} · {formatDate(r.date)}</span><b>{money(r.amountMinor)}</b></li>)}</ul>
              </>
            )}
            <h4>How it is calculated</h4>
            <p>{s.method}</p>
          </div>
        )}
      </div>
    </article>
  );
}

const TARGET_TONE = { on_track: ['On track', 'success'], at_risk: ['At risk', 'warning'], exceeded: ['Over target', 'danger'] };

function TargetCard({ data, onChanged }) {
  const { money, currency } = useAuth();
  const toast = useToast();
  const t = data.target;
  const [value, setValue] = useState(t ? minorToInput(t.targetMinor) : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (targetMinor) => {
    setBusy(true); setError('');
    try { await api.put('/smartsave/target', { targetMinor }); toast.success(targetMinor === null ? 'Target cleared.' : 'Target saved.'); if (targetMinor === null) setValue(''); onChanged(); }
    catch (e) { setError(e.fields?.targetMinor ?? e.message); }
    setBusy(false);
  };
  const submit = (e) => {
    e.preventDefault();
    const parsed = parseOptionalAmount(value);
    if (parsed.error || !value.trim()) { setError(parsed.error ?? 'Enter the most you want to spend on flexible categories each month.'); return; }
    save(parsed.minor);
  };
  const [label, tone] = t ? TARGET_TONE[t.status] : [];
  return (
    <Card title="Your spending-reduction target" subtitle="A monthly cap on flexible (discretionary) categories, tracked against your own history." className="target-card">
      <form className="target-form" onSubmit={submit} noValidate>
        <Field label={`Monthly flexible-spending target (${currency})`} error={error}><input inputMode="decimal" placeholder="e.g. 8000" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
        <Button type="submit" loading={busy}>{t ? 'Update target' : 'Set target'}</Button>
        {t && <Button variant="ghost" onClick={() => save(null)} disabled={busy}>Clear</Button>}
      </form>
      {t && (
        <>
          <div className="split" style={{ marginTop: 16 }}><strong>{money(t.spentMinor)} <span className="muted">of {money(t.targetMinor)} this month</span></strong><Badge tone={tone}>{label}</Badge></div>
          <ProgressBar percent={t.targetMinor > 0 ? (t.spentMinor / t.targetMinor) * 100 : 100} tone={t.status === 'exceeded' ? 'danger' : t.status === 'at_risk' ? 'warning' : 'accent'} label="Flexible spending versus target" />
          <div className="target-stats">
            <div><span>Projected month end</span><strong>{money(t.projectedMinor)}</strong></div>
            <div><span>Left to spend</span><strong>{t.remainingMinor >= 0 ? money(t.remainingMinor) : `Over by ${money(-t.remainingMinor)}`}</strong></div>
            <div><span>Your usual (baseline)</span><strong>{t.baselineMinor === null ? 'Not enough history' : money(t.baselineMinor)}</strong></div>
            <div><span>Reduction goal</span><strong>{t.reductionGoalMinor === null ? '—' : money(t.reductionGoalMinor)}</strong></div>
            <div><span>Progress toward it</span><strong>{t.progressPercent === null ? '—' : `${t.progressPercent}%`}</strong></div>
          </div>
          <p className="muted small">{t.method}{t.flexibleCategories.length ? ` Flexible categories: ${t.flexibleCategories.join(', ')}.` : ' You have no flexible categories with spending yet — mark categories as flexible in Settings.'}</p>
        </>
      )}
      {!t && data.status !== 'disabled' && <p className="muted small">Flexible categories are the ones you can choose to spend less on. You can change which categories count in Settings → Categories.</p>}
      <FormError error="" />
    </Card>
  );
}

export function SmartSavePage() {
  const { money, user } = useAuth();
  const enabled = user.notifications.tips;
  const { data, error, loading, reload } = useApi(() => (enabled ? api.get('/smartsave') : Promise.resolve({ status: 'disabled' })), [enabled]);
  return (
    <>
      <PageHeader title="SmartSave Predictor" subtitle="Personalised ways to save, worked out from your own spending — with the reasoning shown.">
        <Button variant="secondary" icon="history" onClick={() => reload()} loading={loading && !!data}>Refresh</Button>
      </PageHeader>
      {loading && !data && <LoadingBlock rows={4} label="Analysing your spending" />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data && data.status !== 'disabled' && <TargetCard key={data.target?.targetMinor ?? 'none'} data={data} onChanged={() => reload({ silent: true })} />}
      {data?.status === 'disabled' && (
        <Card><EmptyState icon="sparkles" title="SmartSave tips are turned off" action={<Link to="/settings" className="btn btn-primary btn-md">Open settings</Link>}>Turn them back on in Settings → Notifications to see personalised suggestions.</EmptyState></Card>
      )}
      {data?.status === 'insufficient_data' && (
        <Card>
          <EmptyState icon="sparkles" title="SmartSave needs a little more history">
            {data.message}
          </EmptyState>
          <div className="need">
            <div className="split"><span>Expenses logged</span><b>{Math.min(data.expenseCount, data.required.expenses)} / {data.required.expenses}</b></div>
            <ProgressBar percent={(data.expenseCount / data.required.expenses) * 100} label="Expenses logged" />
            <div className="split"><span>Days of history</span><b>{Math.min(data.spanDays, data.required.days)} / {data.required.days}</b></div>
            <ProgressBar percent={(data.spanDays / data.required.days) * 100} label="Days of history" />
            <p className="center"><Link to="/transactions" className="btn btn-primary btn-md">Add transactions</Link></p>
          </div>
        </Card>
      )}
      {data?.status === 'ok' && (
        <div className={loading ? 'is-refreshing' : ''}>
          {data.totalPotentialMinor > 0 && (
            <div className="hero-note"><Icon name="sparkles" size={22} /><div><strong>Up to {money(data.totalPotentialMinor)} a month</strong><span>could be saved if you act on these suggestions.</span></div></div>
          )}
          {data.suggestions.length === 0 ? (
            <Card><EmptyState icon="check" title="Nothing to flag right now">Your recent spending looks steady. Check back as you add more transactions.</EmptyState></Card>
          ) : <div className="suggestions">{data.suggestions.map((s) => <Suggestion key={s.id} s={s} money={money} />)}</div>}
          <p className="muted small disclaimer">{data.note} Based on {data.expenseCount} expenses from {data.window.from} to {data.window.to}.</p>
        </div>
      )}
    </>
  );
}
