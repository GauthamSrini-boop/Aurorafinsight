import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import { useApi } from '../lib/useApi.js';
import { monthLabel, monthOf } from '../lib/dates.js';
import { minorToInput, parseAmount } from '../lib/money.js';
import { Badge, Button, Card, ColorDot, ConfirmDialog, EmptyState, ErrorState, Field, FormError, IconButton, LoadingBlock, Modal, MonthPicker, PageHeader, ProgressBar } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { toneFor } from './Dashboard.jsx';

const STATUS = { ok: ['On track', 'success'], warning: ['Nearing limit', 'warning'], reached: ['Limit reached', 'warning'], exceeded: ['Over budget', 'danger'], none: ['—', 'neutral'] };

function BudgetModal({ month, categories, budget, fixedCategory, onClose, onSaved }) {
  const { currency } = useAuth();
  const toast = useToast();
  const [categoryId, setCategoryId] = useState(budget?.categoryId ?? categories[0]?.id ?? '');
  const [amount, setAmount] = useState(budget ? minorToInput(budget.amountMinor) : '');
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const isOverall = fixedCategory === null;

  const submit = async (e) => {
    e.preventDefault();
    const parsed = parseAmount(amount);
    if (parsed.error) { setError(parsed.error); return; }
    if (!isOverall && !categoryId) { setFormError('Choose a category.'); return; }
    setBusy(true); setError(''); setFormError('');
    try {
      await api.put('/budgets', { month, amountMinor: parsed.minor, categoryId: isOverall ? null : categoryId });
      toast.success('Budget saved.');
      onSaved();
    } catch (err) { setBusy(false); setError(err.fields?.amountMinor ?? ''); if (!err.fields?.amountMinor) setFormError(err.message); }
  };

  return (
    <Modal title={isOverall ? 'Monthly budget' : budget ? `Edit ${budget.categoryName} budget` : 'Add category budget'} onClose={onClose}
      description={`Applies from ${monthLabel(month)} onward until you change it.`}>
      <form className="form" onSubmit={submit} noValidate>
        {!isOverall && !budget && (
          <Field label="Category"><select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        )}
        <Field label={`Budget amount (${currency})`} error={error}><input inputMode="decimal" autoComplete="off" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} data-autofocus /></Field>
        <FormError error={formError} />
        <div className="form-actions"><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" loading={busy}>Save budget</Button></div>
      </form>
    </Modal>
  );
}

function BudgetRow({ b, name, color, money, onEdit, onRemove }) {
  const [label, tone] = STATUS[b.status] ?? STATUS.none;
  return (
    <div className="budget-row">
      <div className="split">
        <span className="budget-name">{color && <ColorDot color={color} />} {name}</span>
        <span className="row-actions"><Badge tone={tone}>{label}</Badge><IconButton icon="edit" label={`Edit ${name} budget`} onClick={onEdit} /><IconButton icon="trash" label={`Remove ${name} budget`} onClick={onRemove} /></span>
      </div>
      <ProgressBar percent={b.percentUsed} tone={toneFor(b.status)} label={`${name} budget used`} />
      <div className="budget-facts">
        <span><b>{money(b.spentMinor)}</b> of {money(b.amountMinor)}</span>
        <span>{b.percentUsed}% used</span>
        <span>{b.status === 'exceeded' ? <span className="neg">Over by {money(b.overByMinor)}</span> : <>{money(b.remainingMinor)} left</>}</span>
        <span>{b.phase === 'current' ? `${b.daysRemaining} day${b.daysRemaining === 1 ? '' : 's'} left` : b.phase === 'future' ? 'Month not started' : 'Month ended'}</span>
        {b.phase !== 'past' && <span title="Remaining budget divided by the days left (including today)">{b.status === 'exceeded' ? 'No spending room left' : <>Suggested: <b>{money(b.suggestedDailyMinor)}</b>/day</>}</span>}
      </div>
      {b.carried && <small className="muted">Carried forward from {monthLabel(b.effectiveMonth)}</small>}
    </div>
  );
}

export function BudgetsPage() {
  const { money, today } = useAuth();
  const toast = useToast();
  const [month, setMonth] = useState(monthOf(today));
  const { data, error, loading, reload } = useApi(() => api.get(`/budgets?month=${month}`), [month]);
  const cats = useApi(() => api.get('/categories'), []);
  const [modal, setModal] = useState(null); // {type:'overall'|'category', budget?}
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);

  const expenseCats = cats.data?.categories.filter((c) => c.kind === 'expense') ?? [];
  const free = expenseCats.filter((c) => !data?.categories.some((b) => b.categoryId === c.id));

  const remove = async () => {
    setBusy(true);
    try { await api.delete(`/budgets/${removing.budget.id}`); toast.success('Budget removed.'); setRemoving(null); reload({ silent: true }); } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const saved = () => { setModal(null); reload({ silent: true }); };

  return (
    <>
      <PageHeader title="Budgets" subtitle="Set a monthly limit and per-category limits. Budgets carry forward until you change them.">
        <MonthPicker month={month} onChange={setMonth} />
      </PageHeader>
      {loading && !data && <LoadingBlock rows={5} label="Loading budgets" />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data && (
        <div className={loading ? 'is-refreshing' : ''}>
          {data.warnings.length > 0 && (
            <div className="warnings" role="region" aria-label="Budget warnings">
              {data.warnings.map((w) => <p key={`${w.scope}-${w.level}`} className={`warn-line ${w.level}`}><Icon name={w.level === 'info' ? 'info' : 'alert'} size={16} /> {w.message}</p>)}
            </div>
          )}
          <Card title="Overall monthly budget" subtitle={monthLabel(month)}
            action={<Button size="sm" variant="secondary" icon={data.overall ? 'edit' : 'plus'} onClick={() => setModal({ type: 'overall', budget: data.overall })}>{data.overall ? 'Edit' : 'Set budget'}</Button>}>
            {data.overall ? (
              <>
                <BudgetRow b={data.overall} name="All spending" money={money} onEdit={() => setModal({ type: 'overall', budget: data.overall })} onRemove={() => setRemoving({ budget: data.overall, name: 'monthly' })} />
              </>
            ) : <EmptyState icon="wallet" title="No monthly budget">Set a limit for the whole month to see remaining amount and a suggested daily spend.</EmptyState>}
          </Card>

          <Card title="Category budgets" action={<Button size="sm" icon="plus" onClick={() => setModal({ type: 'category' })} disabled={!free.length}>Add</Button>}>
            {data.categories.length === 0 ? <EmptyState icon="target" title="No category budgets">Limit what you spend on food, transport and more.</EmptyState> : (
              <div className="budget-list">
                {data.categories.map((c) => <BudgetRow key={c.id} b={c} name={c.categoryName} color={c.color} money={money} onEdit={() => setModal({ type: 'category', budget: c })} onRemove={() => setRemoving({ budget: c, name: c.categoryName })} />)}
              </div>
            )}
            {data.allocatedMinor > 0 && <p className="muted small">Allocated across categories: {money(data.allocatedMinor)}</p>}
          </Card>

          {data.unbudgeted.length > 0 && (
            <Card title="Spending without a budget" subtitle="Categories with spending this month but no limit">
              <ul className="compare">{data.unbudgeted.map((u) => <li key={u.categoryId}><ColorDot color={u.color} /><span className="compare-name">{u.categoryName}</span><span className="compare-val">{money(u.spentMinor)}</span></li>)}</ul>
            </Card>
          )}
        </div>
      )}
      {modal?.type === 'overall' && <BudgetModal month={month} fixedCategory={null} budget={modal.budget} categories={[]} onClose={() => setModal(null)} onSaved={saved} />}
      {modal?.type === 'category' && <BudgetModal month={month} budget={modal.budget} categories={free} onClose={() => setModal(null)} onSaved={saved} />}
      {removing && <ConfirmDialog title="Remove budget?" confirmLabel="Remove" busy={busy} onClose={() => setRemoving(null)} onConfirm={remove}
        message={`The ${removing.name} budget set from ${monthLabel(removing.budget.effectiveMonth)} will be removed. Months that used it will have no limit unless an earlier budget exists.`} />}
    </>
  );
}
