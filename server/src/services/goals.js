import { addDays, diffDays } from '../lib/dates.js';
import { goalPercent } from '../lib/finance.js';

const PACE_WINDOW_DAYS = 60;

/** Goals with saved totals, progress and a pace-based projection. */
export async function listGoals(db, userId, today) {
  const goals = await db.all(
    `SELECT g.id, g.name, g.target_minor, g.deadline, g.description, g.category, g.archived_at, g.created_at,
            COALESCE((SELECT SUM(CASE WHEN c.kind = 'withdrawal' THEN -c.amount_minor ELSE c.amount_minor END) FROM goal_contributions c WHERE c.goal_id = g.id AND c.user_id = g.user_id), 0) AS saved,
            (SELECT COUNT(*) FROM goal_contributions c WHERE c.goal_id = g.id AND c.user_id = g.user_id) AS contribution_count
       FROM goals g WHERE g.user_id = ? ORDER BY g.created_at, g.id`, [userId]);
  const since = addDays(today, -(PACE_WINDOW_DAYS - 1));
  const recent = await db.all(
    "SELECT goal_id, SUM(CASE WHEN kind = 'withdrawal' THEN -amount_minor ELSE amount_minor END) AS total FROM goal_contributions WHERE user_id = ? AND contributed_on >= ? GROUP BY goal_id", [userId, since]);
  const recentBy = new Map(recent.map((r) => [r.goal_id, Number(r.total)]));
  return goals.map((g) => toGoal(g, recentBy.get(g.id) ?? 0, today));
}

export function toGoal(g, recentTotal, today) {
  const target = Number(g.target_minor);
  const saved = Number(g.saved);
  const remaining = Math.max(0, target - saved);
  const complete = saved >= target;
  const paceDaily = Math.max(0, Math.floor(recentTotal / PACE_WINDOW_DAYS));
  const pct = goalPercent(saved, target);
  const nextPct = Math.min(100, (Math.floor(pct / 25) + 1) * 25);
  const nextMilestone = complete ? null : { percent: nextPct, remainingMinor: Math.max(0, Math.ceil((target * nextPct) / 100) - saved) };
  const daysToDeadline = g.deadline ? diffDays(today, g.deadline) : null;
  let projection = null;
  if (!complete && paceDaily > 0) {
    const days = Math.ceil(remaining / paceDaily);
    projection = { days, date: addDays(today, days), basis: `your average of ${PACE_WINDOW_DAYS}-day savings pace` };
  }
  return {
    id: g.id, name: g.name, targetMinor: target, savedMinor: saved, remainingMinor: remaining,
    percent: goalPercent(saved, target), complete, deadline: g.deadline,
    status: g.archived_at ? 'archived' : complete ? 'completed' : g.deadline && g.deadline < today ? 'overdue' : 'active',
    description: g.description ?? null, category: g.category ?? null, archived: !!g.archived_at, archivedAt: g.archived_at ?? null,
    nextMilestone, contributionCount: Number(g.contribution_count ?? 0),
    paceDailyMinor: paceDaily,
    neededDailyMinor: !complete && daysToDeadline !== null && daysToDeadline > 0 ? Math.ceil(remaining / daysToDeadline) : null,
    projection, createdAt: g.created_at,
  };
}

export async function getGoal(db, userId, id, today) {
  const rows = await listGoals(db, userId, today);
  return rows.find((g) => g.id === id) ?? null;
}
