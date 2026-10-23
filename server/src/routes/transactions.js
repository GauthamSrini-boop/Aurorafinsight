import express from 'express';
import { randomUUID } from 'node:crypto';
import { badRequest, notFound, unprocessable } from '../lib/errors.js';
import { validate, schemas } from '../lib/schemas.js';
import { monthOf } from '../lib/dates.js';
import { alertsForNewExpense } from '../services/budgets.js';

const SELECT = `SELECT t.id, t.kind, t.title, t.amount_minor, t.category_id, t.txn_date, t.note, t.created_at, t.updated_at,
                       c.name AS category_name, c.color AS category_color, t.payment_method
                  FROM transactions t JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id`;

export const txnToJSON = (r) => ({
  id: r.id, kind: r.kind, title: r.title, amountMinor: Number(r.amount_minor), categoryId: r.category_id,
  categoryName: r.category_name, categoryColor: r.category_color, date: r.txn_date, note: r.note, paymentMethod: r.payment_method ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
});

const escapeLike = (s) => s.replace(/[\\%_]/g, (m) => `\\${m}`);
const SORTS = {
  date_desc: 't.txn_date DESC, t.created_at DESC, t.id',
  date_asc: 't.txn_date ASC, t.created_at ASC, t.id',
  amount_desc: 't.amount_minor DESC, t.txn_date DESC, t.id',
  amount_asc: 't.amount_minor ASC, t.txn_date DESC, t.id',
};

export function transactionRoutes({ db, clock }) {
  const router = express.Router();

  const fetchOne = async (id, userId) => {
    const row = await db.get(`${SELECT} WHERE t.id = ? AND t.user_id = ?`, [id, userId]);
    if (!row) throw notFound('Transaction');
    return row;
  };

  async function checkRules(req, { kind, categoryId, date }) {
    const cat = await db.get('SELECT id FROM categories WHERE id = ? AND user_id = ? AND kind = ?', [categoryId, req.user.id, kind]);
    if (!cat) throw unprocessable(`Choose one of your ${kind} categories.`, 'invalid_category', { categoryId: `Choose one of your ${kind} categories.` });
    if (date > req.today) throw unprocessable('Transactions cannot be dated in the future.', 'future_date', { date: 'Transactions cannot be dated in the future.' });
  }

  router.get('/', async (req, res) => {
    const q = validate(schemas.transactionQuery, req.query);
    const where = ['t.user_id = ?'];
    const params = [req.user.id];
    if (q.type) { where.push('t.kind = ?'); params.push(q.type); }
    if (q.categoryId) { where.push('t.category_id = ?'); params.push(q.categoryId); }
    if (q.from) { where.push('t.txn_date >= ?'); params.push(q.from); }
    if (q.to) { where.push('t.txn_date <= ?'); params.push(q.to); }
    if (q.year) { where.push('substr(t.txn_date, 1, 4) = ?'); params.push(q.year); }
    if (q.minAmount) { where.push('t.amount_minor >= ?'); params.push(Number(q.minAmount)); }
    if (q.maxAmount) { where.push('t.amount_minor <= ?'); params.push(Number(q.maxAmount)); }
    if (q.paymentMethod) { where.push('lower(t.payment_method) = ?'); params.push(q.paymentMethod.trim().toLowerCase()); }
    if (q.month) { where.push('substr(t.txn_date, 6, 2) = ?'); params.push(String(q.month).padStart(2, '0')); }
    const text = (q.q || '').trim().toLowerCase();
    if (text) {
      const like = `%${escapeLike(text)}%`;
      where.push("(lower(t.title) LIKE ? ESCAPE '\\' OR lower(COALESCE(t.note, '')) LIKE ? ESCAPE '\\' OR lower(c.name) LIKE ? ESCAPE '\\' OR lower(COALESCE(t.payment_method, '')) LIKE ? ESCAPE '\\')");
      params.push(like, like, like, like);
    }
    if (q.minAmount && q.maxAmount && Number(q.minAmount) > Number(q.maxAmount)) throw badRequest('Minimum amount cannot exceed the maximum.', { minAmount: 'Minimum amount cannot exceed the maximum.' });
    const limit = Math.min(Number(q.limit ?? 50) || 50, 200);
    const offset = Number(q.offset ?? 0);
    const base = `FROM transactions t JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id WHERE ${where.join(' AND ')}`;
    const totals = await db.get(
      `SELECT COUNT(*) AS n,
              COALESCE(SUM(CASE WHEN t.kind = 'income' THEN t.amount_minor ELSE 0 END), 0) AS income,
              COALESCE(SUM(CASE WHEN t.kind = 'expense' THEN t.amount_minor ELSE 0 END), 0) AS expense ${base}`, params);
    const rows = await db.all(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY ${SORTS[q.sort || 'date_desc']} LIMIT ? OFFSET ?`, [...params, limit, offset]);
    res.json({
      items: rows.map(txnToJSON), total: Number(totals.n), limit, offset,
      totals: { incomeMinor: Number(totals.income), expenseMinor: Number(totals.expense) },
    });
  });

  router.get('/:id', async (req, res) => res.json({ transaction: txnToJSON(await fetchOne(req.params.id, req.user.id)) }));

  router.post('/', async (req, res) => {
    const body = validate(schemas.transactionCreate, req.body);
    await checkRules(req, body);
    const id = randomUUID();
    const stamp = clock().toISOString();
    await db.run(
      'INSERT INTO transactions (id, user_id, kind, title, amount_minor, category_id, txn_date, note, payment_method, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, req.user.id, body.kind, body.title, body.amountMinor, body.categoryId, body.date, body.note ?? null, body.paymentMethod ?? null, stamp, stamp],
    );
    const alerts = body.kind === 'expense' && req.user.notify_budget
      ? await alertsForNewExpense(db, req.user, { month: monthOf(body.date), categoryId: body.categoryId, amountMinor: body.amountMinor }, req.today)
      : [];
    res.status(201).json({ transaction: txnToJSON(await fetchOne(id, req.user.id)), alerts });
  });

  router.patch('/:id', async (req, res) => {
    const body = validate(schemas.transactionPatch, req.body);
    const cur = await fetchOne(req.params.id, req.user.id);
    const next = {
      kind: body.kind ?? cur.kind, title: body.title ?? cur.title, amountMinor: body.amountMinor ?? Number(cur.amount_minor),
      categoryId: body.categoryId ?? cur.category_id, date: body.date ?? cur.txn_date, note: body.note === undefined ? cur.note : body.note,
      paymentMethod: body.paymentMethod === undefined ? cur.payment_method : body.paymentMethod,
    };
    await checkRules(req, next);
    await db.run(
      'UPDATE transactions SET kind = ?, title = ?, amount_minor = ?, category_id = ?, txn_date = ?, note = ?, payment_method = ?, updated_at = ? WHERE id = ? AND user_id = ?',
      [next.kind, next.title, next.amountMinor, next.categoryId, next.date, next.note, next.paymentMethod, clock().toISOString(), cur.id, req.user.id],
    );
    res.json({ transaction: txnToJSON(await fetchOne(cur.id, req.user.id)) });
  });

  router.delete('/:id', async (req, res) => {
    const { changes } = await db.run('DELETE FROM transactions WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!changes) throw notFound('Transaction');
    res.json({ ok: true });
  });

  return router;
}
