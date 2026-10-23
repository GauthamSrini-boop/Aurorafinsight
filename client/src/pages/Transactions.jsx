import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api, qs } from '../lib/api.js';
import { useApi, useDebounced } from '../lib/useApi.js';
import { MONTH_NAMES, formatDate } from '../lib/dates.js';
import { parseAmount } from '../lib/money.js';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, FilterField, IconButton, LoadingBlock, PageHeader } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { PAYMENT_METHODS, TransactionModal } from '../components/TransactionModal.jsx';

const PAGE = 20;
const EMPTY = { q: '', type: '', categoryId: '', from: '', to: '', year: '', month: '', sort: 'date_desc', minAmount: '', maxAmount: '', paymentMethod: '' };

export function TransactionsPage() {
  const { money, today } = useAuth();
  const toast = useToast();
  const [filters, setFilters] = useState(EMPTY);
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState(null); // null | 'new' | txn
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const q = useDebounced(filters.q, 300);

  const cats = useApi(() => api.get('/categories'), []);
  const min = filters.minAmount.trim() ? parseAmount(filters.minAmount) : null;
  const max = filters.maxAmount.trim() ? parseAmount(filters.maxAmount) : null;
  const amountError = min?.error ? `Minimum: ${min.error}` : max?.error ? `Maximum: ${max.error}` : min?.minor && max?.minor && min.minor > max.minor ? 'Minimum amount cannot exceed the maximum.' : '';
  const params = useMemo(() => {
    const { minAmount, maxAmount, ...rest } = filters;
    return { ...rest, q: q.trim(), paymentMethod: filters.paymentMethod.trim(), limit: PAGE, offset, ...(amountError ? {} : { minAmount: min?.minor, maxAmount: max?.minor }) };
  }, [filters, q, offset, amountError]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data, error, loading, reload } = useApi(() => api.get(`/transactions${qs(params)}`), [JSON.stringify(params)]);

  useEffect(() => { setOffset(0); }, [q, filters.type, filters.categoryId, filters.from, filters.to, filters.year, filters.month, filters.sort, filters.minAmount, filters.maxAmount, filters.paymentMethod]);
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const active = Object.entries(filters).some(([k, v]) => k !== 'sort' && v);
  const years = useMemo(() => { const y = Number(today.slice(0, 4)); return Array.from({ length: 8 }, (_, i) => String(y - i)); }, [today]);
  const rangeBad = filters.from && filters.to && filters.from > filters.to;

  const remove = async () => {
    setBusy(true);
    try { await api.delete(`/transactions/${deleting.id}`); toast.success('Transaction deleted.'); setDeleting(null); reload({ silent: true }); }
    catch (e) { toast.error(e.message); }
    setBusy(false);
  };

  const filterCats = cats.data?.categories.filter((c) => !filters.type || c.kind === filters.type) ?? [];

  return (
    <>
      <PageHeader title="Transactions" subtitle="Every income and expense, searchable by text, date, month, year and category.">
        <Button icon="plus" onClick={() => setEditing('new')} disabled={!cats.data}>Add transaction</Button>
      </PageHeader>

      <Card className="filters">
        <div className="filter-grid">
          <div className="search"><Icon name="search" size={18} />
            <input type="search" aria-label="Search description or note" placeholder="Search description or note" value={filters.q} onChange={set('q')} /></div>
          <FilterField label="Type"><select value={filters.type} onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value, categoryId: '' }))}><option value="">All</option><option value="expense">Expenses</option><option value="income">Income</option></select></FilterField>
          <FilterField label="Category"><select value={filters.categoryId} onChange={set('categoryId')}><option value="">All categories</option>{filterCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></FilterField>
          <FilterField label="From"><input type="date" value={filters.from} max={today} onChange={set('from')} /></FilterField>
          <FilterField label="To"><input type="date" value={filters.to} max={today} onChange={set('to')} /></FilterField>
          <FilterField label="Year"><select value={filters.year} onChange={set('year')}><option value="">Any</option>{years.map((y) => <option key={y}>{y}</option>)}</select></FilterField>
          <FilterField label="Month"><select value={filters.month} onChange={set('month')}><option value="">Any</option>{MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></FilterField>
          <FilterField label="Min amount"><input inputMode="decimal" placeholder="0.00" value={filters.minAmount} onChange={set('minAmount')} /></FilterField>
          <FilterField label="Max amount"><input inputMode="decimal" placeholder="Any" value={filters.maxAmount} onChange={set('maxAmount')} /></FilterField>
          <FilterField label="Payment method"><input list="payment-methods-filter" placeholder="Any" value={filters.paymentMethod} onChange={set('paymentMethod')} /></FilterField>
          <FilterField label="Sort"><select value={filters.sort} onChange={set('sort')}><option value="date_desc">Newest first</option><option value="date_asc">Oldest first</option><option value="amount_desc">Largest amount</option><option value="amount_asc">Smallest amount</option></select></FilterField>
        </div>
        <datalist id="payment-methods-filter">{PAYMENT_METHODS.map((m) => <option key={m} value={m} />)}</datalist>
        {amountError && <p className="field-error">{amountError}</p>}
        {rangeBad && <p className="field-error">“From” must be on or before “To”.</p>}
        {active && <div className="filter-foot"><Button variant="ghost" size="sm" icon="x" onClick={() => setFilters(EMPTY)}>Clear filters</Button></div>}
      </Card>

      {loading && !data && <LoadingBlock rows={6} label="Loading transactions" />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data && (
        <div className={loading ? 'is-refreshing' : ''}>
          <div className="totals-bar" aria-live="polite">
            <span><b>{data.total}</b> {data.total === 1 ? 'transaction' : 'transactions'}{active ? ' match' : ''}</span>
            <span className="pos">Income {money(data.totals.incomeMinor)}</span>
            <span className="neg">Expenses {money(data.totals.expenseMinor)}</span>
            <span>Net <b>{money(data.totals.incomeMinor - data.totals.expenseMinor)}</b></span>
          </div>
          {data.items.length === 0 ? (
            <Card>{active
              ? <EmptyState icon="search" title="No matching transactions" action={<Button variant="secondary" onClick={() => setFilters(EMPTY)}>Clear filters</Button>}>Try a different search or widen the dates.</EmptyState>
              : <EmptyState icon="coins" title="No transactions yet" action={<Button icon="plus" onClick={() => setEditing('new')}>Add transaction</Button>}>Your income and expenses will be listed here.</EmptyState>}</Card>
          ) : (
            <Card className="table-card">
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Date</th><th>Description</th><th>Category</th><th className="num">Amount</th><th><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>
                    {data.items.map((t) => (
                      <tr key={t.id}>
                        <td data-label="Date">{formatDate(t.date)}</td>
                        <td data-label="Description"><strong>{t.title}</strong>{(t.paymentMethod || t.note) && <small className="note">{[t.paymentMethod, t.note].filter(Boolean).join(' · ')}</small>}</td>
                        <td data-label="Category"><Badge tone={t.kind === 'income' ? 'success' : 'neutral'}>{t.categoryName}</Badge></td>
                        <td data-label="Amount" className={`num ${t.kind === 'income' ? 'pos' : ''}`}>{t.kind === 'income' ? '+' : '−'}{money(t.amountMinor)}</td>
                        <td className="row-actions">
                          <IconButton icon="edit" label={`Edit ${t.title}`} onClick={() => setEditing(t)} />
                          <IconButton icon="trash" label={`Delete ${t.title}`} onClick={() => setDeleting(t)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="pager">
                <span>Showing {offset + 1}–{Math.min(offset + PAGE, data.total)} of {data.total}</span>
                <div>
                  <Button variant="secondary" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</Button>
                  <Button variant="secondary" size="sm" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>Next</Button>
                </div>
              </div>
            </Card>
          )}
        </div>
      )}

      {editing && cats.data && <TransactionModal txn={editing === 'new' ? undefined : editing} categories={cats.data.categories} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload({ silent: true }); }} />}
      {deleting && <ConfirmDialog title="Delete transaction?" message={`“${deleting.title}” (${money(deleting.amountMinor)}) will be permanently removed.`} onConfirm={remove} onClose={() => setDeleting(null)} busy={busy} />}
    </>
  );
}
