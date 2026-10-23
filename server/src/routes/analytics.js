import express from 'express';
import { validate, schemas } from '../lib/schemas.js';
import { monthOf } from '../lib/dates.js';
import { dashboard, monthAnalytics, trends } from '../services/analytics.js';
import { smartSave } from '../services/smartsave.js';

export function analyticsRoutes({ db, clock }) {
  const router = express.Router();
  router.get('/dashboard', async (req, res) => {
    const q = validate(schemas.monthQuery, req.query);
    res.json(await dashboard(db, req.user, q.month ?? monthOf(req.today), req.today));
  });
  router.get('/analytics', async (req, res) => {
    const q = validate(schemas.analyticsQuery, req.query);
    res.json(await monthAnalytics(db, req.user, q.month ?? monthOf(req.today), req.today, q.categoryId ?? null));
  });
  router.get('/analytics/trends', async (req, res) => {
    const q = validate(schemas.yearQuery, req.query);
    res.json(await trends(db, req.user, q.year ?? req.today.slice(0, 4)));
  });
  router.get('/smartsave', async (req, res) => res.json(await smartSave(db, req.user, req.today)));
  router.put('/smartsave/target', async (req, res) => {
    const body = validate(schemas.smartsaveTarget, req.body);
    await db.run('UPDATE users SET smartsave_target_minor = ?, updated_at = ? WHERE id = ?', [body.targetMinor, clock().toISOString(), req.user.id]);
    const fresh = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    res.json(await smartSave(db, fresh, req.today));
  });
  return router;
}
