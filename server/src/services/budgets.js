import { budgetStatus, LEVEL_RANK } from '../lib/finance.js';
import { formatMoney } from '../lib/money.js';
import { monthEnd, monthStart } from '../lib/dates.js';

/**
 * Budgets are effective-dated: a budget set for a month applies to that month
 * and every later month until another one replaces it.
 */
export async function budgetOverview(db, user, month, today) {
  const uid = user.id;
  const fmt = (m) => formatMoney(m, user.currency);
  const budgetRows = await db.all(
    'SELECT id, category_id, effective_month, amount_minor FROM budgets WHERE user_id = ? AND effective_month <= ? ORDER BY effective_month',
    [uid, month],
  );
  const latest = new Map(); // key -> row (later rows overwrite earlier ones)
  for (const r of budgetRows) latest.set(r.category_id ?? '__overall__', r);

  const spentRows = await db.all(
    `SELECT category_id, SUM(amount_minor) AS spent FROM transactions
      WHERE user_id = ? AND kind = 'expense' AND txn_date >= ? AND txn_date <= ? GROUP BY category_id`,
    [uid, monthStart(month), monthEnd(month)],
  );
  const spentBy = new Map(spentRows.map((r) => [r.category_id, Number(r.spent)]));
  const totalSpent = [...spentBy.values()].reduce((a, b) => a + b, 0);
  const cats = await db.all("SELECT id, name, color FROM categories WHERE user_id = ? AND kind = 'expense'", [uid]);
  const catById = new Map(cats.map((c) => [c.id, c]));

  const build = (row, spentMinor, extra = {}) => ({
    id: row.id, effectiveMonth: row.effective_month, carried: row.effective_month !== month,
    amountMinor: Number(row.amount_minor), spentMinor, ...budgetStatus({ budgetMinor: Number(row.amount_minor), spentMinor, month, today }), ...extra,
  });

  const overallRow = latest.get('__overall__');
  const overall = overallRow ? build(overallRow, totalSpent) : null;

  const categories = [];
  for (const [key, row] of latest) {
    if (key === '__overall__') continue;
    const c = catById.get(key);
    if (!c) continue;
    categories.push(build(row, spentBy.get(key) ?? 0, { categoryId: c.id, categoryName: c.name, color: c.color }));
  }
  categories.sort((a, b) => b.percentUsed - a.percentUsed || a.categoryName.localeCompare(b.categoryName));

  const budgeted = new Set(categories.map((c) => c.categoryId));
  const unbudgeted = [...spentBy.entries()]
    .filter(([id]) => !budgeted.has(id))
    .map(([id, spentMinor]) => ({ categoryId: id, categoryName: catById.get(id)?.name ?? 'Uncategorised', color: catById.get(id)?.color ?? 'slate', spentMinor }))
    .sort((a, b) => b.spentMinor - a.spentMinor);

  const warnings = [];
  const label = (scope, s) => {
    if (s.status === 'exceeded') return `${scope} is over budget by ${fmt(s.overByMinor)}.`;
    if (s.status === 'reached') return `${scope} has used its entire budget.`;
    return `${scope} has used ${s.percentUsed}% of its budget.`;
  };
  if (overall && LEVEL_RANK[overall.status] >= 1) warnings.push({ scope: 'overall', level: overall.status, message: label('Your monthly budget', overall) });
  for (const c of categories) {
    if (LEVEL_RANK[c.status] >= 1) warnings.push({ scope: c.categoryId, level: c.status, message: label(c.categoryName, c) });
  }
  const allocatedMinor = categories.reduce((a, c) => a + c.amountMinor, 0);
  if (overall && allocatedMinor > overall.amountMinor) {
    warnings.push({ scope: 'allocation', level: 'info', message: `Your category budgets add up to ${fmt(allocatedMinor)}, more than your overall budget of ${fmt(overall.amountMinor)}.` });
  }

  return { month, overall, categories, unbudgeted, allocatedMinor, warnings, totalSpentMinor: totalSpent };
}

/** Alerts raised by a newly added expense (only when it pushes a budget up a level). */
export async function alertsForNewExpense(db, user, { month, categoryId, amountMinor }, today) {
  const after = await budgetOverview(db, user, month, today);
  const fmt = (m) => formatMoney(m, user.currency);
  const alerts = [];
  const crossed = (s) => {
    const beforeSpent = s.spentMinor - amountMinor;
    const before = budgetStatus({ budgetMinor: s.amountMinor, spentMinor: beforeSpent, month, today });
    return LEVEL_RANK[s.status] > LEVEL_RANK[before.status] && LEVEL_RANK[s.status] >= 1;
  };
  const text = (scope, s) => (s.status === 'exceeded' ? `${scope} is now ${fmt(s.overByMinor)} over budget.`
    : s.status === 'reached' ? `${scope} has hit its limit.` : `${scope} has used ${s.percentUsed}% of its budget.`);
  if (after.overall && crossed(after.overall)) alerts.push({ scope: 'overall', level: after.overall.status, message: text('Your monthly budget', after.overall) });
  const cat = after.categories.find((c) => c.categoryId === categoryId);
  if (cat && crossed(cat)) alerts.push({ scope: categoryId, level: cat.status, message: text(cat.categoryName, cat) });
  return alerts;
}
