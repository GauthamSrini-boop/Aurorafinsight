import { addMonths, daysInMonth, monthEnd, monthStart, weekday } from '../lib/dates.js';
import { daysElapsed } from '../lib/finance.js';
import { percentOf } from '../lib/money.js';
import { txnToJSON } from '../routes/transactions.js';
import { budgetOverview } from './budgets.js';
import { listGoals } from './goals.js';
import { notFound } from '../lib/errors.js';

const n = (v) => Number(v ?? 0);

const sumsFor = async (db, uid, from, to, categoryId = null) => {
  const r = await db.get(
    `SELECT COALESCE(SUM(CASE WHEN kind = 'income' THEN amount_minor END), 0) AS income,
            COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount_minor END), 0) AS expense,
            COUNT(*) AS count
       FROM transactions WHERE user_id = ? AND txn_date >= ? AND txn_date <= ?${categoryId ? ' AND category_id = ?' : ''}`, categoryId ? [uid, from, to, categoryId] : [uid, from, to]);
  return { incomeMinor: n(r.income), expenseMinor: n(r.expense), netMinor: n(r.income) - n(r.expense), count: n(r.count) };
};

const pctChange = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) * 100) / prev) : null);

async function categoryTotals(db, uid, from, to) {
  const rows = await db.all(
    `SELECT c.id, c.name, c.color, SUM(t.amount_minor) AS total, COUNT(*) AS count
       FROM transactions t JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
      WHERE t.user_id = ? AND t.kind = 'expense' AND t.txn_date >= ? AND t.txn_date <= ?
      GROUP BY c.id, c.name, c.color`, [uid, from, to]);
  return rows.map((r) => ({ id: r.id, name: r.name, color: r.color, totalMinor: n(r.total), count: n(r.count) }));
}

/** Everything the Analytics page needs for one month, computed from the user's records. */
export async function monthAnalytics(db, user, month, today, categoryId = null) {
  const uid = user.id;
  let filter = null;
  if (categoryId) {
    const c = await db.get('SELECT id, name, color, kind FROM categories WHERE id = ? AND user_id = ?', [categoryId, uid]);
    if (!c) throw notFound('Category');
    filter = { categoryId: c.id, categoryName: c.name, kind: c.kind };
  }
  const prevMonth = addMonths(month, -1);
  const current = await sumsFor(db, uid, monthStart(month), monthEnd(month), categoryId);
  const previous = await sumsFor(db, uid, monthStart(prevMonth), monthEnd(prevMonth), categoryId);
  const dim = daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1);
  const elapsed = daysElapsed(month, today);
  const phase = today < monthStart(month) ? 'future' : today > monthEnd(month) ? 'past' : 'current';

  const cats = await categoryTotals(db, uid, monthStart(month), monthEnd(month));
  const prevCats = new Map((await categoryTotals(db, uid, monthStart(prevMonth), monthEnd(prevMonth))).map((c) => [c.id, c.totalMinor]));
  const breakdown = cats
    .map((c) => ({
      categoryId: c.id, name: c.name, color: c.color, totalMinor: c.totalMinor, count: c.count,
      percent: percentOf(c.totalMinor, current.expenseMinor),
      share: current.expenseMinor ? (c.totalMinor * 100) / current.expenseMinor : 0,
      previousMinor: prevCats.get(c.id) ?? 0, changePercent: pctChange(c.totalMinor, prevCats.get(c.id) ?? 0),
    }))
    .sort((a, b) => b.totalMinor - a.totalMinor || a.name.localeCompare(b.name));

  const dayRows = await db.all(
    `SELECT txn_date AS d,
            SUM(CASE WHEN kind = 'expense' THEN amount_minor ELSE 0 END) AS expense,
            SUM(CASE WHEN kind = 'income' THEN amount_minor ELSE 0 END) AS income
       FROM transactions WHERE user_id = ? AND txn_date >= ? AND txn_date <= ?${categoryId ? ' AND category_id = ?' : ''} GROUP BY txn_date`,
    categoryId ? [uid, monthStart(month), monthEnd(month), categoryId] : [uid, monthStart(month), monthEnd(month)]);
  const byDay = new Map(dayRows.map((r) => [r.d, { expenseMinor: n(r.expense), incomeMinor: n(r.income) }]));
  const daily = [];
  for (let i = 1; i <= dim; i += 1) {
    const date = `${month}-${String(i).padStart(2, '0')}`;
    daily.push({ date, day: i, ...(byDay.get(date) ?? { expenseMinor: 0, incomeMinor: 0 }) });
  }
  const elapsedDays = daily.slice(0, elapsed);
  let weekdaySum = 0; let weekendSum = 0; let weekdayN = 0; let weekendN = 0;
  for (const d of elapsedDays) {
    const w = weekday(d.date);
    if (w === 0 || w === 6) { weekendSum += d.expenseMinor; weekendN += 1; } else { weekdaySum += d.expenseMinor; weekdayN += 1; }
  }
  const topDay = [...daily].sort((a, b) => b.expenseMinor - a.expenseMinor)[0];
  const largest = await db.get(
    `SELECT t.id, t.kind, t.title, t.amount_minor, t.category_id, t.txn_date, t.note, t.payment_method, t.created_at, t.updated_at, c.name AS category_name, c.color AS category_color
       FROM transactions t JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
      WHERE t.user_id = ? AND t.kind = 'expense' AND t.txn_date >= ? AND t.txn_date <= ?${categoryId ? ' AND t.category_id = ?' : ''} ORDER BY t.amount_minor DESC, t.id LIMIT 1`,
    categoryId ? [uid, monthStart(month), monthEnd(month), categoryId] : [uid, monthStart(month), monthEnd(month)]);

  return {
    month, filter, phase, daysInMonth: dim, daysElapsed: elapsed,
    totals: current, previous,
    comparison: {
      expenseChangePercent: pctChange(current.expenseMinor, previous.expenseMinor),
      incomeChangePercent: pctChange(current.incomeMinor, previous.incomeMinor),
      expenseDifferenceMinor: current.expenseMinor - previous.expenseMinor,
    },
    savingsRatePercent: current.incomeMinor > 0 ? Math.round((current.netMinor * 100) / current.incomeMinor) : null,
    averageDailySpendMinor: elapsed > 0 ? Math.round(current.expenseMinor / elapsed) : 0,
    projectedMonthEndMinor: phase === 'current' && elapsed > 0 ? Math.round((current.expenseMinor / elapsed) * dim) : current.expenseMinor,
    weekdayAverageMinor: weekdayN ? Math.round(weekdaySum / weekdayN) : 0,
    weekendAverageMinor: weekendN ? Math.round(weekendSum / weekendN) : 0,
    topDay: topDay && topDay.expenseMinor > 0 ? { date: topDay.date, expenseMinor: topDay.expenseMinor } : null,
    largestExpense: largest ? txnToJSON(largest) : null,
    breakdown, daily,
  };
}

/** Month-by-month series for a year plus all-year totals. */
export async function trends(db, user, year) {
  const uid = user.id;
  const rows = await db.all(
    `SELECT substr(txn_date, 6, 2) AS m,
            SUM(CASE WHEN kind = 'expense' THEN amount_minor ELSE 0 END) AS expense,
            SUM(CASE WHEN kind = 'income' THEN amount_minor ELSE 0 END) AS income
       FROM transactions WHERE user_id = ? AND substr(txn_date, 1, 4) = ? GROUP BY substr(txn_date, 6, 2)`, [uid, String(year)]);
  const by = new Map(rows.map((r) => [Number(r.m), { expenseMinor: n(r.expense), incomeMinor: n(r.income) }]));
  const months = [];
  for (let i = 1; i <= 12; i += 1) {
    const v = by.get(i) ?? { expenseMinor: 0, incomeMinor: 0 };
    months.push({ month: `${year}-${String(i).padStart(2, '0')}`, ...v, netMinor: v.incomeMinor - v.expenseMinor });
  }
  const active = months.filter((m) => m.expenseMinor > 0);
  const years = (await db.all(
    `SELECT substr(txn_date, 1, 4) AS y,
            SUM(CASE WHEN kind = 'expense' THEN amount_minor ELSE 0 END) AS expense,
            SUM(CASE WHEN kind = 'income' THEN amount_minor ELSE 0 END) AS income
       FROM transactions WHERE user_id = ? GROUP BY substr(txn_date, 1, 4) ORDER BY y`, [uid]))
    .map((r) => ({ year: Number(r.y), expenseMinor: n(r.expense), incomeMinor: n(r.income), netMinor: n(r.income) - n(r.expense) }));
  const sum = (k) => months.reduce((a, m) => a + m[k], 0);
  return {
    year: Number(year), months, years,
    totals: { incomeMinor: sum('incomeMinor'), expenseMinor: sum('expenseMinor'), netMinor: sum('netMinor') },
    averageMonthlyExpenseMinor: active.length ? Math.round(sum('expenseMinor') / active.length) : 0,
    highestMonth: active.length ? [...active].sort((a, b) => b.expenseMinor - a.expenseMinor)[0].month : null,
    lowestMonth: active.length ? [...active].sort((a, b) => a.expenseMinor - b.expenseMinor)[0].month : null,
  };
}

export async function dashboard(db, user, month, today) {
  const uid = user.id;
  const analytics = await monthAnalytics(db, user, month, today);
  const all = await db.get(
    `SELECT COALESCE(SUM(CASE WHEN kind = 'income' THEN amount_minor END), 0) AS income,
            COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount_minor END), 0) AS expense, COUNT(*) AS count
       FROM transactions WHERE user_id = ?`, [uid]);
  const recent = await db.all(
    `SELECT t.id, t.kind, t.title, t.amount_minor, t.category_id, t.txn_date, t.note, t.payment_method, t.created_at, t.updated_at, c.name AS category_name, c.color AS category_color
       FROM transactions t JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
      WHERE t.user_id = ? ORDER BY t.txn_date DESC, t.created_at DESC, t.id LIMIT 8`, [uid]);
  const goals = (await listGoals(db, uid, today)).filter((g) => !g.archived);
  const open = goals.filter((g) => !g.complete);
  const budgets = await budgetOverview(db, user, month, today);
  const year = await trends(db, user, month.slice(0, 4));
  return {
    month,
    openingBalanceMinor: n(user.opening_balance_minor),
    balanceMinor: n(user.opening_balance_minor) + n(all.income) - n(all.expense),
    allTime: { incomeMinor: n(all.income), expenseMinor: n(all.expense), count: n(all.count) },
    totals: analytics.totals, previous: analytics.previous, comparison: analytics.comparison,
    savingsRatePercent: analytics.savingsRatePercent, averageDailySpendMinor: analytics.averageDailySpendMinor,
    projectedMonthEndMinor: analytics.projectedMonthEndMinor,
    topCategories: analytics.breakdown.slice(0, 5),
    recent: recent.map(txnToJSON),
    budget: { overall: budgets.overall, warnings: budgets.warnings },
    goals: {
      count: goals.length, completed: goals.length - open.length,
      savedMinor: goals.reduce((a, g) => a + g.savedMinor, 0), targetMinor: goals.reduce((a, g) => a + g.targetMinor, 0),
      items: open.slice(0, 3),
      milestones: open.filter((g) => g.nextMilestone).map((g) => ({ goalId: g.id, name: g.name, percent: g.nextMilestone.percent, remainingMinor: g.nextMilestone.remainingMinor }))
        .sort((a, b) => a.remainingMinor - b.remainingMinor).slice(0, 3),
    },
    yearTrend: year.months,
  };
}

