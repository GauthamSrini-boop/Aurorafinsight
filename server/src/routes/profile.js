import express from 'express';
import { badRequest, unauthorized } from '../lib/errors.js';
import { validate, schemas } from '../lib/schemas.js';
import { hashPassword, passwordPolicyError, verifyPassword } from '../lib/password.js';
import { serializeCookie } from '../lib/cookies.js';
import { userToJSON } from '../services/users.js';
import { destroyOtherSessions } from '../services/sessions.js';

export function profileRoutes({ db, config, clock }) {
  const router = express.Router();

  router.get('/', (req, res) => res.json({ user: userToJSON(req.user) }));

  router.patch('/', async (req, res) => {
    const body = validate(schemas.profilePatch, req.body);
    const sets = [];
    const params = [];
    const add = (col, val) => { sets.push(`${col} = ?`); params.push(val); };
    if (body.name !== undefined) add('name', body.name);
    if (body.currency !== undefined) add('currency', body.currency);
    if (body.theme !== undefined) add('theme', body.theme);
    if (body.timezone !== undefined) add('timezone', body.timezone);
    if (body.openingBalanceMinor !== undefined) add('opening_balance_minor', body.openingBalanceMinor);
    if (body.notifications?.budget !== undefined) add('notify_budget', body.notifications.budget ? 1 : 0);
    if (body.notifications?.goals !== undefined) add('notify_goals', body.notifications.goals ? 1 : 0);
    if (body.notifications?.tips !== undefined) add('notify_tips', body.notifications.tips ? 1 : 0);
    if (!sets.length) throw badRequest('Nothing to update.');
    add('updated_at', clock().toISOString());
    await db.run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...params, req.user.id]);
    res.json({ user: userToJSON(await db.get('SELECT * FROM users WHERE id = ?', [req.user.id])) });
  });

  router.post('/password', async (req, res) => {
    const body = validate(schemas.passwordChange, req.body);
    if (!(await verifyPassword(body.currentPassword, req.user.password_hash))) {
      throw badRequest('Your current password is incorrect.', { currentPassword: 'Your current password is incorrect.' });
    }
    const policy = passwordPolicyError(body.newPassword);
    if (policy) throw badRequest(policy, { newPassword: policy });
    const hash = await hashPassword(body.newPassword, config.scryptN);
    await db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [hash, clock().toISOString(), req.user.id]);
    await destroyOtherSessions(db, req.user.id, req.sessionId); // sign out every other device
    res.json({ ok: true });
  });

  router.delete('/', async (req, res) => {
    const body = validate(schemas.accountDelete, req.body);
    if (!(await verifyPassword(body.password, req.user.password_hash))) throw unauthorized('Password is incorrect.');
    await db.run('DELETE FROM users WHERE id = ?', [req.user.id]); // cascades to every owned row
    res.append('Set-Cookie', serializeCookie(config.cookieName, '', { maxAgeSeconds: 0, secure: config.cookieSecure }));
    res.json({ ok: true });
  });

  router.get('/export', async (req, res) => {
    const uid = req.user.id;
    const [categories, transactions, budgets, goals, contributions] = await Promise.all([
      db.all('SELECT id, name, kind, color, flexible FROM categories WHERE user_id = ? ORDER BY kind, name', [uid]),
      db.all('SELECT id, kind, title, amount_minor AS amountMinor, category_id AS categoryId, txn_date AS date, note, payment_method AS paymentMethod FROM transactions WHERE user_id = ? ORDER BY txn_date, id', [uid]),
      db.all('SELECT id, category_id AS categoryId, effective_month AS effectiveMonth, amount_minor AS amountMinor FROM budgets WHERE user_id = ? ORDER BY effective_month', [uid]),
      db.all('SELECT id, name, target_minor AS targetMinor, deadline, description, category, archived_at AS archivedAt FROM goals WHERE user_id = ? ORDER BY created_at', [uid]),
      db.all('SELECT id, goal_id AS goalId, amount_minor AS amountMinor, contributed_on AS date, note, kind FROM goal_contributions WHERE user_id = ? ORDER BY contributed_on', [uid]),
    ]);
    res.set('Content-Disposition', 'attachment; filename="aurora-finsight-export.json"');
    res.json({
      app: 'Aurora FinSight', exportedAt: clock().toISOString(), note: 'Amounts are in minor units (paise/cents).',
      user: userToJSON(req.user), categories, transactions, budgets, goals, contributions,
    });
  });

  return router;
}
