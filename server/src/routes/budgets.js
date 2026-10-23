import express from 'express';
import { randomUUID } from 'node:crypto';
import { notFound, unprocessable } from '../lib/errors.js';
import { validate, schemas } from '../lib/schemas.js';
import { monthOf } from '../lib/dates.js';
import { budgetOverview } from '../services/budgets.js';

export function budgetRoutes({ db, clock }) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const q = validate(schemas.monthQuery, req.query);
    const month = q.month ?? monthOf(req.today);
    res.json(await budgetOverview(db, req.user, month, req.today));
  });

  router.put('/', async (req, res) => {
    const body = validate(schemas.budgetPut, req.body);
    const categoryId = body.categoryId ?? null;
    if (categoryId) {
      const cat = await db.get("SELECT id FROM categories WHERE id = ? AND user_id = ? AND kind = 'expense'", [categoryId, req.user.id]);
      if (!cat) throw unprocessable('Choose one of your expense categories.', 'invalid_category', { categoryId: 'Choose one of your expense categories.' });
    }
    const stamp = clock().toISOString();
    const existing = await db.get(
      "SELECT id FROM budgets WHERE user_id = ? AND coalesce(category_id, '') = ? AND effective_month = ?",
      [req.user.id, categoryId ?? '', body.month],
    );
    let id;
    if (existing) {
      id = existing.id;
      await db.run('UPDATE budgets SET amount_minor = ?, updated_at = ? WHERE id = ? AND user_id = ?', [body.amountMinor, stamp, id, req.user.id]);
    } else {
      id = randomUUID();
      await db.run('INSERT INTO budgets (id, user_id, category_id, effective_month, amount_minor, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, req.user.id, categoryId, body.month, body.amountMinor, stamp, stamp]);
    }
    res.status(existing ? 200 : 201).json({ budget: { id, categoryId, effectiveMonth: body.month, amountMinor: body.amountMinor } });
  });

  router.delete('/:id', async (req, res) => {
    const { changes } = await db.run('DELETE FROM budgets WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!changes) throw notFound('Budget');
    res.json({ ok: true });
  });

  return router;
}
