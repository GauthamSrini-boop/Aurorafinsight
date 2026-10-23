import express from 'express';
import { randomUUID } from 'node:crypto';
import { conflict, notFound } from '../lib/errors.js';
import { validate, schemas } from '../lib/schemas.js';

const toJSON = (r) => ({ id: r.id, name: r.name, kind: r.kind, color: r.color, flexible: !!r.flexible, usageCount: r.usage_count ?? 0 });

export function categoryRoutes({ db, clock }) {
  const router = express.Router();

  const one = async (id, userId) => {
    const row = await db.get(
      `SELECT c.*, (SELECT COUNT(*) FROM transactions t WHERE t.category_id = c.id AND t.user_id = c.user_id) AS usage_count
         FROM categories c WHERE c.id = ? AND c.user_id = ?`, [id, userId]);
    if (!row) throw notFound('Category');
    return row;
  };

  router.get('/', async (req, res) => {
    const rows = await db.all(
      `SELECT c.*, (SELECT COUNT(*) FROM transactions t WHERE t.category_id = c.id AND t.user_id = c.user_id) AS usage_count
         FROM categories c WHERE c.user_id = ? ORDER BY c.kind, lower(c.name)`, [req.user.id]);
    res.json({ categories: rows.map(toJSON) });
  });

  router.post('/', async (req, res) => {
    const body = validate(schemas.categoryCreate, req.body);
    const exists = await db.get('SELECT id FROM categories WHERE user_id = ? AND kind = ? AND lower(name) = ?', [req.user.id, body.kind, body.name.toLowerCase()]);
    if (exists) throw conflict('You already have a category with that name.', 'duplicate_category');
    const id = randomUUID();
    await db.run('INSERT INTO categories (id, user_id, name, kind, color, flexible, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, req.user.id, body.name, body.kind, body.color ?? 'slate', body.flexible ? 1 : 0, clock().toISOString()]);
    res.status(201).json({ category: toJSON(await one(id, req.user.id)) });
  });

  router.patch('/:id', async (req, res) => {
    const body = validate(schemas.categoryPatch, req.body);
    const current = await one(req.params.id, req.user.id);
    if (body.name !== undefined && body.name.toLowerCase() !== current.name.toLowerCase()) {
      const dupe = await db.get('SELECT id FROM categories WHERE user_id = ? AND kind = ? AND lower(name) = ? AND id <> ?', [req.user.id, current.kind, body.name.toLowerCase(), current.id]);
      if (dupe) throw conflict('You already have a category with that name.', 'duplicate_category');
    }
    await db.run('UPDATE categories SET name = ?, color = ?, flexible = ? WHERE id = ? AND user_id = ?',
      [body.name ?? current.name, body.color ?? current.color, body.flexible === undefined ? current.flexible : body.flexible ? 1 : 0, current.id, req.user.id]);
    res.json({ category: toJSON(await one(current.id, req.user.id)) });
  });

  router.delete('/:id', async (req, res) => {
    const current = await one(req.params.id, req.user.id);
    if (current.usage_count > 0) {
      throw conflict(`${current.usage_count} transaction${current.usage_count === 1 ? ' uses' : 's use'} this category. Move or delete them first.`, 'category_in_use');
    }
    await db.run('DELETE FROM categories WHERE id = ? AND user_id = ?', [current.id, req.user.id]);
    res.json({ ok: true });
  });

  return router;
}
