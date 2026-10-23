import { useState } from 'react';
import { Button, Field, FormError, Modal, Segmented } from './ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import { minorToInput, parseAmount } from '../lib/money.js';

export const PAYMENT_METHODS = ['Cash', 'UPI', 'Debit card', 'Credit card', 'Bank transfer', 'Net banking', 'Wallet'];

/** Add or edit a transaction. `categories` is the user's full category list. */
export function TransactionModal({ txn, categories, onClose, onSaved, defaultKind = 'expense' }) {
  const { today, currency } = useAuth();
  const toast = useToast();
  const [kind, setKind] = useState(txn?.kind ?? defaultKind);
  const [form, setForm] = useState({
    title: txn?.title ?? '', amount: txn ? minorToInput(txn.amountMinor) : '', date: txn?.date ?? today, note: txn?.note ?? '',
    categoryId: txn?.categoryId ?? '', paymentMethod: txn?.paymentMethod ?? '',
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const options = categories.filter((c) => c.kind === kind);
  const categoryId = options.some((c) => c.id === form.categoryId) ? form.categoryId : options[0]?.id ?? '';
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    const amount = parseAmount(form.amount);
    if (amount.error) next.amount = amount.error;
    if (!form.title.trim()) next.title = 'Description is required.';
    if (!form.date) next.date = 'Date is required.'; else if (form.date > today) next.date = 'Transactions cannot be dated in the future.';
    if (!categoryId) next.categoryId = 'Choose a category.';
    setErrors(next); setFormError('');
    if (Object.keys(next).length) return;
    setBusy(true);
    const body = { kind, title: form.title.trim(), amountMinor: amount.minor, categoryId, date: form.date, note: form.note.trim() || null, paymentMethod: form.paymentMethod.trim() || null };
    try {
      const res = txn ? await api.patch(`/transactions/${txn.id}`, body) : await api.post('/transactions', body);
      toast.success(txn ? 'Transaction updated.' : `${kind === 'income' ? 'Income' : 'Expense'} added.`);
      if (res.alerts?.length) toast.fromServer(res.alerts);
      onSaved(res.transaction);
    } catch (err) {
      setBusy(false);
      const fields = {};
      for (const [k, v] of Object.entries(err.fields ?? {})) fields[k === 'amountMinor' ? 'amount' : k] = v;
      setErrors(fields);
      if (!Object.keys(fields).length) setFormError(err.message);
    }
  };

  return (
    <Modal title={txn ? 'Edit transaction' : 'Add transaction'} onClose={onClose}>
      <form onSubmit={submit} noValidate className="form">
        <Segmented label="Transaction type" value={kind} onChange={setKind} options={[{ value: 'expense', label: 'Expense', icon: 'down' }, { value: 'income', label: 'Income', icon: 'up' }]} />
        <Field label={`Amount (${currency})`} error={errors.amount}>
          <input inputMode="decimal" autoComplete="off" placeholder="0.00" value={form.amount} onChange={set('amount')} data-autofocus />
        </Field>
        <Field label="Description" error={errors.title}>
          <input maxLength={120} placeholder={kind === 'income' ? 'e.g. October salary' : 'e.g. Groceries'} value={form.title} onChange={set('title')} />
        </Field>
        <div className="grid-2">
          <Field label="Category" error={errors.categoryId}>
            <select value={categoryId} onChange={set('categoryId')}>{options.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </Field>
          <Field label="Date" error={errors.date} hint="Any day up to today.">
            <input type="date" max={today} min="2000-01-01" value={form.date} onChange={set('date')} />
          </Field>
        </div>
        <Field label="Payment method (optional)" error={errors.paymentMethod} hint="e.g. UPI, Card, Cash — pick one or type your own.">
          <input list="payment-methods" maxLength={40} autoComplete="off" value={form.paymentMethod} onChange={set('paymentMethod')} />
        </Field>
        <datalist id="payment-methods">{PAYMENT_METHODS.map((m) => <option key={m} value={m} />)}</datalist>
        <Field label="Note (optional)" error={errors.note}>
          <textarea rows={2} maxLength={500} value={form.note} onChange={set('note')} />
        </Field>
        <FormError error={formError} />
        <div className="form-actions">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy}>{txn ? 'Save changes' : 'Add transaction'}</Button>
        </div>
      </form>
    </Modal>
  );
}
