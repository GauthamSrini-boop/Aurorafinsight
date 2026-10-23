import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, registerUser } from './helpers.js';

let t;
before(async () => { t = await startTestServer(); }); // "now" = 2026-10-15 09:00Z => 2026-10-15 in Asia/Kolkata
after(async () => { await t.close(); });

async function login() {
  const c = t.client();
  const user = await registerUser(c);
  const cats = (await c.get('/api/categories')).body.categories;
  const cat = (name) => cats.find((x) => x.name === name).id;
  const add = async (kind, title, amountMinor, category, date) => {
    const r = await c.post('/api/transactions', { kind, title, amountMinor, categoryId: cat(category), date });
    assert.equal(r.status, 201, r.text);
    return r.body.transaction;
  };
  return { c, user, cat, add };
}

test('analytics, dashboard and trends are computed from real records', async () => {
  const { c, add } = await login();
  await add('income', 'Salary Sep', 200000, 'Salary', '2026-09-01');
  await add('expense', 'Groceries', 30000, 'Food & Dining', '2026-09-10');
  await add('expense', 'Bus pass', 10000, 'Transport', '2026-09-12');
  await add('income', 'Salary Oct', 200000, 'Salary', '2026-10-01');
  await add('expense', 'Groceries', 20000, 'Food & Dining', '2026-10-03');
  await add('expense', 'Dinner', 25000, 'Food & Dining', '2026-10-10');
  await add('expense', 'Bus pass', 5000, 'Transport', '2026-10-10');

  const a = (await c.get('/api/analytics?month=2026-10')).body;
  assert.deepEqual([a.totals.incomeMinor, a.totals.expenseMinor, a.totals.netMinor], [200000, 50000, 150000]);
  assert.deepEqual([a.previous.expenseMinor, a.comparison.expenseChangePercent, a.comparison.expenseDifferenceMinor], [40000, 25, 10000]);
  assert.equal(a.savingsRatePercent, 75);
  assert.equal(a.daysElapsed, 15);
  assert.equal(a.averageDailySpendMinor, Math.round(50000 / 15));
  assert.equal(a.projectedMonthEndMinor, Math.round((50000 / 15) * 31));
  const food = a.breakdown.find((b) => b.name === 'Food & Dining');
  assert.deepEqual([a.breakdown[0].name, food.totalMinor, food.percent, food.previousMinor, food.changePercent], ['Food & Dining', 45000, 90, 30000, 50]);
  assert.equal(a.daily.length, 31);
  assert.equal(a.daily[9].expenseMinor, 30000); // 10 Oct
  assert.deepEqual(a.topDay, { date: '2026-10-10', expenseMinor: 30000 });
  assert.equal(a.largestExpense.amountMinor, 25000);

  const past = (await c.get('/api/analytics?month=2026-09')).body;
  assert.equal(past.phase, 'past');
  assert.equal(past.averageDailySpendMinor, Math.round(40000 / 30));

  const d = (await c.get('/api/dashboard')).body;
  assert.equal(d.month, '2026-10');
  assert.equal(d.balanceMinor, 400000 - 90000);
  assert.equal(d.recent.length, 7);
  assert.equal(d.recent[0].date, '2026-10-10');
  assert.equal(d.topCategories[0].name, 'Food & Dining');
  assert.equal(d.yearTrend.length, 12);

  const tr = (await c.get('/api/analytics/trends?year=2026')).body;
  assert.equal(tr.months[8].expenseMinor, 40000);
  assert.equal(tr.months[9].expenseMinor, 50000);
  assert.deepEqual([tr.totals.incomeMinor, tr.totals.expenseMinor], [400000, 90000]);
  assert.equal(tr.averageMonthlyExpenseMinor, 45000);
  assert.equal(tr.highestMonth, '2026-10');
  assert.equal(tr.lowestMonth, '2026-09');

  assert.equal((await c.get('/api/analytics?month=2026-13')).status, 400);
  assert.equal((await c.get('/api/analytics?bogus=1')).status, 400);
});

test('SmartSave refuses to guess with too little data, then explains its suggestions', async () => {
  const { c, add } = await login();
  const empty = (await c.get('/api/smartsave')).body;
  assert.equal(empty.status, 'insufficient_data');
  assert.deepEqual(empty.suggestions, []);
  await add('expense', 'Tea', 100, 'Food & Dining', '2026-10-14');
  assert.equal((await c.get('/api/smartsave')).body.status, 'insufficient_data');

  for (const m of ['07', '08', '09']) {
    for (const day of ['05', '12', '20']) await add('expense', `Groceries ${m}-${day}`, 10000, 'Food & Dining', `2026-${m}-${day}`);
    await add('expense', 'Netflix', 64900, 'Bills & Utilities', `2026-${m}-03`);
  }
  await add('income', 'Salary', 100000, 'Salary', '2026-09-01');
  await add('expense', 'Netflix', 64900, 'Bills & Utilities', '2026-10-03');
  for (const day of ['02', '05', '08', '12']) await add('expense', `Groceries Oct ${day}`, 20000, 'Food & Dining', `2026-10-${day}`);
  const goal = (await c.post('/api/goals', { name: 'Laptop', targetMinor: 100000 })).body.goal;
  assert.equal((await c.post(`/api/goals/${goal.id}/contributions`, { amountMinor: 6000, date: '2026-10-14' })).status, 201);

  const s = (await c.get('/api/smartsave')).body;
  assert.equal(s.status, 'ok');
  const by = (type) => s.suggestions.find((x) => x.type === type);
  const over = s.suggestions.find((x) => x.id.startsWith('overspend:'));
  assert.equal(over.monthlyImpactMinor, Math.round((80100 / 15) * 31) - 30000);
  assert.equal(over.type, 'category_overspend');
  assert.ok(over.evidence.length >= 3 && over.method.length > 10);
  assert.equal(by('recurring_charge').monthlyImpactMinor, 64900);
  assert.equal(by('low_savings_rate').monthlyImpactMinor, 10000 - (100000 - 94900));
  assert.equal(by('goal_impact').monthlyImpactMinor, 0);
  const impacts = s.suggestions.filter((x) => x.type !== 'goal_impact').map((x) => x.monthlyImpactMinor);
  assert.deepEqual(impacts, [...impacts].sort((a, b) => b - a));
  assert.equal(s.totalPotentialMinor, impacts.reduce((x, y) => x + y, 0));
  for (const x of s.suggestions) assert.ok(['high', 'medium', 'low'].includes(x.confidence));
});

test('every resource is isolated between users', async () => {
  const a = await login(); const b = await login();
  const txn = await a.add('expense', 'Secret lunch', 12345, 'Food & Dining', '2026-10-10');
  const cat = (await a.c.post('/api/categories', { name: 'Secret cat', kind: 'expense' })).body.category;
  const bud = (await a.c.put('/api/budgets', { month: '2026-10', amountMinor: 500000 })).body;
  const budId = bud.budget?.id ?? bud.id;
  const goal = (await a.c.post('/api/goals', { name: 'Secret goal', targetMinor: 90000 })).body.goal;
  const con = await a.c.post(`/api/goals/${goal.id}/contributions`, { amountMinor: 1000, date: '2026-10-10' });
  assert.equal(con.status, 201);
  const conId = (await a.c.get(`/api/goals/${goal.id}/contributions`)).body.contributions[0].id;

  const denied = [
    ['get', `/api/transactions/${txn.id}`], ['patch', `/api/transactions/${txn.id}`, { title: 'hacked' }], ['delete', `/api/transactions/${txn.id}`],
    ['patch', `/api/categories/${cat.id}`, { name: 'hacked' }], ['delete', `/api/categories/${cat.id}`],
    ['get', `/api/goals/${goal.id}`], ['patch', `/api/goals/${goal.id}`, { name: 'hacked' }], ['delete', `/api/goals/${goal.id}`],
    ['get', `/api/goals/${goal.id}/contributions`], ['post', `/api/goals/${goal.id}/contributions`, { amountMinor: 100, date: '2026-10-10' }],
    ['delete', `/api/goals/${goal.id}/contributions/${conId}`],
  ];
  if (budId) denied.push(['delete', `/api/budgets/${budId}`]);
  for (const [m, p, body] of denied) {
    const r = await b.c[m](p, body);
    assert.equal(r.status, 404, `${m} ${p} -> ${r.status} ${r.text}`);
  }

  // B can't file a transaction or budget against A's category
  assert.equal((await b.c.post('/api/transactions', { kind: 'expense', title: 'x', amountMinor: 100, categoryId: cat.id, date: '2026-10-10' })).status, 422);
  assert.equal((await b.c.post('/api/transactions', { kind: 'expense', title: 'x', amountMinor: 100, categoryId: a.cat('Food & Dining'), date: '2026-10-10' })).status, 422);
  assert.ok([404, 422].includes((await b.c.put('/api/budgets', { month: '2026-10', categoryId: cat.id, amountMinor: 100 })).status));

  // B sees nothing of A's anywhere
  assert.equal((await b.c.get('/api/transactions')).body.total, 0);
  assert.equal((await b.c.get('/api/goals')).body.goals.length, 0);
  assert.ok(!(await b.c.get('/api/categories')).body.categories.some((x) => x.name === 'Secret cat'));
  const dash = (await b.c.get('/api/dashboard')).body;
  assert.equal(dash.balanceMinor, 0);
  assert.equal(dash.recent.length, 0);
  assert.equal(dash.goals.count, 0);
  assert.equal((await b.c.get('/api/analytics?month=2026-10')).body.totals.expenseMinor, 0);
  assert.equal((await b.c.get('/api/analytics/trends?year=2026')).body.totals.expenseMinor, 0);
  assert.equal((await b.c.get('/api/smartsave')).body.status, 'insufficient_data');
  assert.ok(!JSON.stringify((await b.c.get('/api/profile/export')).body).includes('Secret'));

  // A's data is untouched
  assert.equal((await a.c.get(`/api/transactions/${txn.id}`)).body.transaction.title, 'Secret lunch');
  assert.equal((await a.c.get(`/api/goals/${goal.id}`)).body.goal.name, 'Secret goal');
  assert.equal((await a.c.get('/api/dashboard')).body.balanceMinor, -12345);

  // unauthenticated requests are rejected everywhere
  const anon = t.client();
  for (const p of ['/api/dashboard', '/api/analytics', '/api/analytics/trends', '/api/smartsave', '/api/transactions', '/api/goals', '/api/budgets', '/api/categories', '/api/profile']) {
    assert.equal((await anon.get(p)).status, 401, p);
  }
});
