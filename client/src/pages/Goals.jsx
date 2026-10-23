import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import { useApi } from '../lib/useApi.js';
import { formatDate } from '../lib/dates.js';
import { minorToInput, parseAmount, parseOptionalAmount } from '../lib/money.js';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, FormError, IconButton, LoadingBlock, Modal, PageHeader, ProgressBar } from '../components/ui.jsx';
import { Ring } from '../components/charts.jsx';
import { Icon } from '../components/Icon.jsx';

const CATEGORY_IDEAS = ['Emergency', 'Travel', 'Gadgets', 'Education', 'Home', 'Vehicle', 'Health', 'Other'];
const mapFields = (fields, renames) => Object.fromEntries(Object.entries(fields ?? {}).map(([k, v]) => [renames[k] ?? k, v]));

function GoalModal({ goal, onClose, onSaved }) {
  const { currency, today } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({
    name: goal?.name ?? '', target: goal ? minorToInput(goal.targetMinor) : '', saved: '', deadline: goal?.deadline ?? '',
    description: goal?.description ?? '', category: goal?.category ?? '',
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!form.name.trim()) next.name = 'Give your goal a name.';
    const target = parseAmount(form.target);
    if (target.error) next.target = target.error;
    let saved = { minor: 0 };
    if (!goal) { saved = parseOptionalAmount(form.saved); if (saved.error) next.saved = saved.error; else if (!target.error && saved.minor > target.minor) next.saved = 'Already saved cannot be more than the target.'; }
    if (form.deadline && !goal && form.deadline < today) next.deadline = 'Choose a date in the future.';
    setErrors(next); setFormError('');
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const body = { name: form.name.trim(), targetMinor: target.minor, deadline: form.deadline || null, description: form.description.trim() || null, category: form.category.trim() || null };
      if (goal) await api.patch(`/goals/${goal.id}`, body); else await api.post('/goals', { ...body, ...(saved.minor > 0 ? { savedMinor: saved.minor } : {}) });
      toast.success(goal ? 'Goal updated.' : 'Goal created.');
      onSaved();
    } catch (err) {
      setBusy(false);
      const f = mapFields(err.fields, { targetMinor: 'target', savedMinor: 'saved' });
      setErrors(f); if (!Object.keys(f).length) setFormError(err.message);
    }
  };

  return (
    <Modal title={goal ? 'Edit goal' : 'New savings goal'} onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        <Field label="Goal name" error={errors.name}><input maxLength={80} placeholder="e.g. Emergency fund" value={form.name} onChange={set('name')} data-autofocus /></Field>
        <Field label={`Target amount (${currency})`} error={errors.target}><input inputMode="decimal" placeholder="0.00" value={form.target} onChange={set('target')} /></Field>
        {!goal && <Field label={`Already saved (${currency}, optional)`} error={errors.saved}><input inputMode="decimal" placeholder="0.00" value={form.saved} onChange={set('saved')} /></Field>}
        <div className="grid-2">
          <Field label="Target date (optional)" error={errors.deadline} hint="Used to work out how much to save each day."><input type="date" min={goal ? undefined : today} value={form.deadline} onChange={set('deadline')} /></Field>
          <Field label="Category (optional)" error={errors.category}><input list="goal-categories" maxLength={40} value={form.category} onChange={set('category')} /></Field>
        </div>
        <datalist id="goal-categories">{CATEGORY_IDEAS.map((c) => <option key={c} value={c} />)}</datalist>
        <Field label="Description (optional)" error={errors.description}><textarea rows={2} maxLength={300} value={form.description} onChange={set('description')} /></Field>
        <FormError error={formError} />
        <div className="form-actions"><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" loading={busy}>{goal ? 'Save changes' : 'Create goal'}</Button></div>
      </form>
    </Modal>
  );
}

/** Add money to a goal, or withdraw / correct it (mode: 'add' | 'withdraw'). */
function MoneyModal({ goal, mode, onClose, onSaved }) {
  const { currency, today, money } = useAuth();
  const toast = useToast();
  const withdraw = mode === 'withdraw';
  const limit = withdraw ? goal.savedMinor : goal.remainingMinor;
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    const parsed = parseAmount(amount);
    if (parsed.error) next.amount = parsed.error;
    else if (parsed.minor > limit) next.amount = withdraw ? `Only ${money(limit)} is saved in this goal.` : `Only ${money(limit)} is needed to complete this goal.`;
    if (!date || date > today) next.date = 'Choose a date up to today.';
    setErrors(next); setFormError('');
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const res = await api.post(`/goals/${goal.id}/${withdraw ? 'withdrawals' : 'contributions'}`, { amountMinor: parsed.minor, date, note: note.trim() || null });
      toast.success(withdraw ? `Withdrew ${money(parsed.minor)} from ${goal.name}.` : `Added ${money(parsed.minor)} to ${goal.name}.`);
      if (res.notification) toast.fromServer(res.notification);
      onSaved();
    } catch (err) {
      setBusy(false);
      const f = mapFields(err.fields, { amountMinor: 'amount' });
      setErrors(f); if (!Object.keys(f).length) setFormError(err.message);
    }
  };

  return (
    <Modal title={withdraw ? `Withdraw from ${goal.name}` : `Add to ${goal.name}`} onClose={onClose}
      description={withdraw ? `${money(goal.savedMinor)} saved. Use this to take money out or correct a mistake.` : `${money(goal.remainingMinor)} still needed.`}>
      <form className="form" onSubmit={submit} noValidate>
        <Field label={`Amount (${currency})`} error={errors.amount}><input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} data-autofocus /></Field>
        <Field label="Date" error={errors.date}><input type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Note (optional)"><input maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <FormError error={formError} />
        <div className="form-actions"><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" loading={busy} variant={withdraw ? 'secondary' : 'primary'}>{withdraw ? 'Withdraw' : 'Add savings'}</Button></div>
      </form>
    </Modal>
  );
}

function HistoryModal({ goal, onClose, onChanged }) {
  const { money } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useApi(() => api.get(`/goals/${goal.id}/contributions`), [goal.id]);
  const [busyId, setBusyId] = useState(null);
  const remove = async (c) => {
    setBusyId(c.id);
    try { await api.delete(`/goals/${goal.id}/contributions/${c.id}`); toast.success('Entry removed.'); await reload({ silent: true }); onChanged(); } catch (e) { toast.error(e.message); }
    setBusyId(null);
  };
  return (
    <Modal title={`${goal.name} · history`} onClose={onClose}>
      {loading && !data && <LoadingBlock rows={3} />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data && (data.contributions.length === 0 ? <p className="muted">No savings added yet.</p> : (
        <ul className="history">
          {data.contributions.map((c) => (
            <li key={c.id}>
              <span><strong className={c.kind === 'withdrawal' ? 'neg' : ''}>{c.kind === 'withdrawal' ? '−' : ''}{money(c.amountMinor)}</strong>
                <small>{c.kind === 'withdrawal' ? 'Withdrawal · ' : ''}{formatDate(c.date)}{c.note ? ` · ${c.note}` : ''}</small></span>
              <IconButton icon="trash" label={`Remove ${money(c.amountMinor)} ${c.kind === 'withdrawal' ? 'withdrawal' : 'contribution'}`} onClick={() => remove(c)} disabled={busyId === c.id} />
            </li>
          ))}
        </ul>
      ))}
    </Modal>
  );
}

function GoalCard({ g, money, setModal }) {
  return (
    <Card className={`goal ${g.complete ? 'goal-done' : ''} ${g.archived ? 'goal-archived' : ''}`}>
      <div className="goal-top">
        <Ring percent={g.percent} tone={g.complete ? 'success' : 'accent'}>{g.complete ? <Icon name="check" size={22} /> : `${g.percent}%`}</Ring>
        <div className="goal-title">
          <h3>{g.name}</h3>
          <div className="row">
            {g.archived ? <Badge>Archived</Badge> : g.complete ? <Badge tone="success">Completed</Badge> : g.status === 'overdue' ? <Badge tone="danger">Overdue</Badge> : <Badge>Active</Badge>}
            {g.category && <Badge tone="neutral">{g.category}</Badge>}
            {g.deadline && <small className="muted"><Icon name="calendar" size={13} /> {formatDate(g.deadline)}</small>}
          </div>
        </div>
        <div className="row-actions">
          <IconButton icon="edit" label={`Edit ${g.name}`} onClick={() => setModal({ type: 'edit', goal: g })} />
          <IconButton icon="trash" label={`Delete ${g.name}`} onClick={() => setModal({ type: 'delete', goal: g })} />
        </div>
      </div>
      {g.description && <p className="goal-desc">{g.description}</p>}
      <ProgressBar percent={g.percent} tone={g.complete ? 'success' : 'accent'} label={`${g.name} progress`} />
      <div className="kv"><span>Saved</span><strong>{money(g.savedMinor)}</strong></div>
      <div className="kv"><span>Target</span><strong>{money(g.targetMinor)}</strong></div>
      <div className="kv"><span>Remaining</span><strong>{money(g.remainingMinor)}</strong></div>
      {!g.archived && !g.complete && g.nextMilestone && <p className="goal-note"><Icon name="target" size={14} /> <span><b>{money(g.nextMilestone.remainingMinor)}</b> to your {g.nextMilestone.percent}% milestone</span></p>}
      {!g.archived && !g.complete && g.neededDailyMinor !== null && <p className="goal-note"><Icon name="bolt" size={14} /> <span>Save about <b>{money(g.neededDailyMinor)}</b>/day to hit {formatDate(g.deadline)}</span></p>}
      {!g.archived && !g.complete && g.projection && <p className="goal-note muted"><Icon name="calendar" size={14} /> <span>At your recent pace: {formatDate(g.projection.date)}{g.deadline && g.projection.date > g.deadline ? ' (after your target date)' : ''}</span></p>}
      {!g.archived && !g.complete && !g.projection && g.contributionCount === 0 && <p className="goal-note muted">Add your first savings to see a projection.</p>}
      <div className="goal-actions">
        {g.archived ? (
          <Button size="sm" variant="secondary" icon="history" onClick={() => setModal({ type: 'restore', goal: g })}>Restore</Button>
        ) : (
          <>
            <Button size="sm" icon="plus" onClick={() => setModal({ type: 'add', goal: g })} disabled={g.complete}>Add savings</Button>
            <Button size="sm" variant="secondary" icon="down" onClick={() => setModal({ type: 'withdraw', goal: g })} disabled={g.savedMinor <= 0}>Withdraw</Button>
          </>
        )}
        <Button size="sm" variant="ghost" icon="history" onClick={() => setModal({ type: 'history', goal: g })}>History</Button>
        {!g.archived && <Button size="sm" variant="ghost" onClick={() => setModal({ type: 'archive', goal: g })} aria-label={`Archive ${g.name}`}>Archive</Button>}
      </div>
    </Card>
  );
}

export function GoalsPage() {
  const { money } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useApi(() => api.get('/goals'), []);
  const [modal, setModal] = useState(null); // {type, goal}
  const [tab, setTab] = useState('active');
  const [busy, setBusy] = useState(false);
  const close = () => setModal(null);
  const done = () => { close(); reload({ silent: true }); };

  const run = async (fn, okMessage) => {
    setBusy(true);
    try { await fn(); toast.success(okMessage); done(); } catch (e) { toast.error(e.message); }
    setBusy(false);
  };

  const all = data?.goals ?? [];
  const active = all.filter((g) => !g.archived);
  const archived = all.filter((g) => g.archived);
  const shown = tab === 'archived' ? archived : active;
  const totalSaved = active.reduce((a, g) => a + g.savedMinor, 0);
  const totalTarget = active.reduce((a, g) => a + g.targetMinor, 0);

  return (
    <>
      <PageHeader title="Savings goals" subtitle="Track several goals at once, each with its own target and progress.">
        <Button icon="plus" onClick={() => setModal({ type: 'edit' })}>New goal</Button>
      </PageHeader>
      {loading && !data && <LoadingBlock rows={4} label="Loading goals" />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data && (all.length === 0 ? (
        <Card><EmptyState icon="target" title="No goals yet" action={<Button icon="plus" onClick={() => setModal({ type: 'edit' })}>Create your first goal</Button>}>Set a target — a laptop, a trip, an emergency fund — and watch your progress.</EmptyState></Card>
      ) : (
        <div className={loading ? 'is-refreshing' : ''}>
          <div className="tabs" role="tablist" aria-label="Goal status">
            <button type="button" role="tab" aria-selected={tab === 'active'} onClick={() => setTab('active')}>Active ({active.length})</button>
            <button type="button" role="tab" aria-selected={tab === 'archived'} onClick={() => setTab('archived')}>Archived ({archived.length})</button>
          </div>
          {tab === 'active' && <div className="totals-bar"><span><b>{active.length}</b> goal{active.length === 1 ? '' : 's'}</span><span>Saved <b>{money(totalSaved)}</b></span><span>Target <b>{money(totalTarget)}</b></span></div>}
          {shown.length === 0 ? (
            <Card><EmptyState icon="target" title={tab === 'archived' ? 'No archived goals' : 'No active goals'}>{tab === 'archived' ? 'Archive a goal to hide it from your overview without losing its history.' : 'Create a goal or restore an archived one.'}</EmptyState></Card>
          ) : <div className="goal-grid">{shown.map((g) => <GoalCard key={g.id} g={g} money={money} setModal={setModal} />)}</div>}
        </div>
      ))}
      {modal?.type === 'edit' && <GoalModal goal={modal.goal} onClose={close} onSaved={done} />}
      {modal?.type === 'add' && <MoneyModal goal={modal.goal} mode="add" onClose={close} onSaved={done} />}
      {modal?.type === 'withdraw' && <MoneyModal goal={modal.goal} mode="withdraw" onClose={close} onSaved={done} />}
      {modal?.type === 'history' && <HistoryModal goal={modal.goal} onClose={close} onChanged={() => reload({ silent: true })} />}
      {modal?.type === 'archive' && <ConfirmDialog title="Archive goal?" confirmLabel="Archive" variant="secondary" busy={busy} onClose={close}
        onConfirm={() => run(() => api.patch(`/goals/${modal.goal.id}`, { archived: true }), 'Goal archived.')}
        message={`“${modal.goal.name}” will be hidden from your overview and dashboard. Its savings history is kept and you can restore it any time.`} />}
      {modal?.type === 'restore' && <ConfirmDialog title="Restore goal?" confirmLabel="Restore" variant="primary" busy={busy} onClose={close}
        onConfirm={() => run(() => api.patch(`/goals/${modal.goal.id}`, { archived: false }), 'Goal restored.')}
        message={`“${modal.goal.name}” will become active again.`} />}
      {modal?.type === 'delete' && <ConfirmDialog title="Delete goal?" busy={busy} onClose={close} onConfirm={() => run(() => api.delete(`/goals/${modal.goal.id}`), 'Goal deleted.')}
        message={`“${modal.goal.name}” and its ${modal.goal.contributionCount} savings entr${modal.goal.contributionCount === 1 ? 'y' : 'ies'} will be permanently removed.`} />}
    </>
  );
}
