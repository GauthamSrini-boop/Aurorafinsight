import express from 'express';
import { randomUUID } from 'node:crypto';
import { notFound, unprocessable } from '../lib/errors.js';
import { validate, schemas } from '../lib/schemas.js';
import { formatMoney } from '../lib/money.js';
import { getGoal, listGoals } from '../services/goals.js';
import { goalPercent } from '../lib/finance.js';

const contributionToJSON = (r) => ({
  id: r.id, goalId: r.goal_id, kind: r.kind ?? 'deposit', amountMinor: Number(r.amount_minor), date: r.contributed_on, note: r.note, createdAt: r.created_at,
});
const SIGNED = "CASE WHEN kind = 'withdrawal' THEN -amount_minor ELSE amount_minor END";

/** Completion beats milestones; a milestone fires only when this deposit crosses 25/50/75%. */
function goalNotification(updated, savedBefore, goal) {
  if (updated.complete) return { level: 'success', message: `Goal reached: ${updated.name}!` };
  const was = goalPercent(savedBefore, Number(goal.target_minor));
  const crossed = [75, 50, 25].find((m) => was < m && updated.percent >= m);
  return crossed ? { level: 'info', message: `${updated.name} is ${crossed}% funded — keep going!` } : null;
}

export function goalRoutes({ db, clock }) {
  const router = express.Router();

  const ownGoal = async (id, userId) => {
    const g = await db.get('SELECT * FROM goals WHERE id = ? AND user_id = ?', [id, userId]);
    if (!g) throw notFound('Goal');
    return g;
  };
  const savedOf = async (tx, goalId, userId) =>
    Number((await tx.get(`SELECT COALESCE(SUM(${SIGNED}), 0) AS s FROM goal_contributions WHERE goal_id = ? AND user_id = ?`, [goalId, userId])).s);
  const checkDate = (date, today) => {
    if (date > today) throw unprocessable('Dates cannot be in the future.', 'future_date', { date: 'Dates cannot be in the future.' });
  };

  router.get('/', async (req, res) => res.json({ goals: await listGoals(db, req.user.id, req.today) }));

  router.post('/', async (req, res) => {
    const body = validate(schemas.goalCreate, req.body);
    const saved = body.savedMinor ?? 0;
    if (saved > body.targetMinor) throw unprocessable('Already saved cannot exceed the target.', 'exceeds_target', { savedMinor: 'Already saved cannot exceed the target.' });
    const id = randomUUID();
    const stamp = clock().toISOString();
    await db.transaction(async (tx) => {
      await tx.run('INSERT INTO goals (id, user_id, name, target_minor, deadline, description, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, req.user.id, body.name, body.targetMinor, body.deadline ?? null, body.description ?? null, body.category ?? null, stamp, stamp]);
      if (saved > 0) {
        await tx.run('INSERT INTO goal_contributions (id, user_id, goal_id, amount_minor, contributed_on, note, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [randomUUID(), req.user.id, id, saved, req.today, 'Opening balance', 'deposit', stamp]);
      }
    });
    res.status(201).json({ goal: await getGoal(db, req.user.id, id, req.today) });
  });

  router.get('/:id', async (req, res) => {
    await ownGoal(req.params.id, req.user.id);
    res.json({ goal: await getGoal(db, req.user.id, req.params.id, req.today) });
  });

  router.patch('/:id', async (req, res) => {
    const body = validate(schemas.goalPatch, req.body);
    const cur = await ownGoal(req.params.id, req.user.id);
    const stamp = clock().toISOString();
    const next = {
      name: body.name ?? cur.name, targetMinor: body.targetMinor ?? Number(cur.target_minor),
      deadline: body.deadline === undefined ? cur.deadline : body.deadline,
      description: body.description === undefined ? cur.description : body.description,
      category: body.category === undefined ? cur.category : body.category,
      archivedAt: body.archived === undefined ? cur.archived_at : body.archived ? (cur.archived_at ?? stamp) : null,
    };
    const saved = await savedOf(db, cur.id, req.user.id);
    if (next.targetMinor < saved) {
      throw unprocessable(`The target cannot be lower than the ${formatMoney(saved, req.user.currency)} already saved.`, 'target_below_saved', { targetMinor: 'Target is below the amount already saved.' });
    }
    await db.run('UPDATE goals SET name = ?, target_minor = ?, deadline = ?, description = ?, category = ?, archived_at = ?, updated_at = ? WHERE id = ? AND user_id = ?',
      [next.name, next.targetMinor, next.deadline, next.description, next.category, next.archivedAt, stamp, cur.id, req.user.id]);
    res.json({ goal: await getGoal(db, req.user.id, cur.id, req.today) });
  });

  router.delete('/:id', async (req, res) => {
    const { changes } = await db.run('DELETE FROM goals WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!changes) throw notFound('Goal');
    res.json({ ok: true });
  });

  router.get('/:id/contributions', async (req, res) => {
    await ownGoal(req.params.id, req.user.id);
    const rows = await db.all('SELECT * FROM goal_contributions WHERE goal_id = ? AND user_id = ? ORDER BY contributed_on DESC, created_at DESC, id', [req.params.id, req.user.id]);
    res.json({ contributions: rows.map(contributionToJSON) });
  });

  // Shared by deposits and withdrawals.
  const addEntry = (kind) => async (req, res) => {
    const body = validate(schemas.contribution, req.body);
    const goal = await ownGoal(req.params.id, req.user.id);
    if (goal.archived_at) throw unprocessable('This goal is archived. Restore it to change its savings.', 'goal_archived');
    const date = body.date ?? req.today;
    checkDate(date, req.today);
    const id = randomUUID();
    let before = 0;
    await db.transaction(async (tx) => {
      const saved = await savedOf(tx, goal.id, req.user.id);
      before = saved;
      if (kind === 'deposit') {
        const remaining = Number(goal.target_minor) - saved;
        if (remaining <= 0) throw unprocessable('This goal is already complete.', 'goal_complete');
        if (body.amountMinor > remaining) {
          throw unprocessable(`Only ${formatMoney(remaining, req.user.currency)} is needed to complete this goal.`, 'exceeds_target', { amountMinor: 'That is more than the amount still needed.' });
        }
      } else if (body.amountMinor > saved) {
        throw unprocessable(`Only ${formatMoney(saved, req.user.currency)} is saved in this goal.`, 'exceeds_saved', { amountMinor: 'That is more than the amount saved.' });
      }
      await tx.run('INSERT INTO goal_contributions (id, user_id, goal_id, amount_minor, contributed_on, note, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, req.user.id, goal.id, body.amountMinor, date, body.note ?? null, kind, clock().toISOString()]);
    });
    const updated = await getGoal(db, req.user.id, goal.id, req.today);
    res.status(201).json({
      contribution: contributionToJSON(await db.get('SELECT * FROM goal_contributions WHERE id = ? AND user_id = ?', [id, req.user.id])),
      goal: updated,
      notification: kind === 'deposit' && req.user.notify_goals ? goalNotification(updated, before, goal) : null,
    });
  };
  router.post('/:id/contributions', addEntry('deposit'));
  router.post('/:id/withdrawals', addEntry('withdrawal'));

  router.delete('/:id/contributions/:cid', async (req, res) => {
    const goal = await ownGoal(req.params.id, req.user.id);
    await db.transaction(async (tx) => {
      const entry = await tx.get('SELECT * FROM goal_contributions WHERE id = ? AND goal_id = ? AND user_id = ?', [req.params.cid, goal.id, req.user.id]);
      if (!entry) throw notFound('Contribution');
      const saved = await savedOf(tx, goal.id, req.user.id);
      const after = saved - (entry.kind === 'withdrawal' ? -1 : 1) * Number(entry.amount_minor);
      if (after < 0) throw unprocessable('Removing this entry would leave a negative saved amount. Remove the later withdrawals first.', 'negative_balance');
      if (after > Number(goal.target_minor)) throw unprocessable('Removing this withdrawal would put the goal over its target.', 'exceeds_target');
      await tx.run('DELETE FROM goal_contributions WHERE id = ? AND user_id = ?', [entry.id, req.user.id]);
    });
    res.json({ ok: true, goal: await getGoal(db, req.user.id, req.params.id, req.today) });
  });

  return router;
}
