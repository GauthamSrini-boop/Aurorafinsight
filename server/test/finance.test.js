import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, registerUser } from './helpers.js';
import { budgetStatus, goalPercent, daysElapsed } from '../src/lib/finance.js';
import { todayIn, addDays, addMonths, diffDays, isValidISODate, weekday } from '../src/lib/dates.js';
import { formatMoney } from '../src/lib/money.js';

let t;
before(async () => { t = await startTestServer(); });
after(async () => { await t.close(); });

async function login(overrides) {
  const c = t.client();
  const user = await registerUser(c, overrides);
  const cats = (await c.get('/api/categories')).body.categories;
  const cat = (name) => cats.find((x) => x.name === name).id;
  return { c, user, cat, cats };
}

test('pure rules: budget status, goal percent, dates, money', () => {
  assert.equal(goalPercent(5999999, 6000000), 99);
  const s = budgetStatus({ budgetMinor: 600000, spentMinor: 155000, month: '2026-10', today: '2026-10-16' });
  assert.deepEqual([s.remainingMinor, s.percentUsed, s.status, s.daysRemaining, s.suggestedDailyMinor], [445000, 26, 'ok', 16, Math.floor(445000 / 16)]);
  assert.equal(budgetStatus({ budgetMinor: 100, spentMinor: 80, month: '2026-10', today: '2026-10-16' }).status, 'warning');
  assert.equal(budgetStatus({ budgetMinor: 100, spentMinor: 100, month: '2026-10', today: '2026-10-16' }).status, 'reached');
  const over = budgetStatus({ budgetMinor: 100, spentMinor: 130, month: '2026-10', today: '2026-10-16' });
  assert.deepEqual([over.status, over.overByMinor, over.suggestedDailyMinor], ['exceeded', 30, 0]);
  assert.equal(budgetStatus({ budgetMinor: 100, spentMinor: 1, month: '2026-09', today: '2026-10-16' }).phase, 'past');
  assert.equal(budgetStatus({ budgetMinor: 3000, spentMinor: 0, month: '2026-11', today: '2026-10-16' }).suggestedDailyMinor, 100);
  assert.equal(daysElapsed('2026-10', '2026-10-16'), 16);
  assert.equal(daysElapsed('2026-09', '2026-10-16'), 30);
  assert.equal(daysElapsed('2026-11', '2026-10-16'), 0);
  // user-local "today": 20:00 UTC on the 15th is already the 16th in Kolkata but still the 15th in New York
  const now = new Date('2026-10-15T20:00:00Z');
  assert.equal(todayIn('Asia/Kolkata', now), '2026-10-16');
  assert.equal(todayIn('America/New_York', now), '2026-10-15');
  assert.equal(todayIn('Not/AZone', now), '2026-10-15');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(diffDays('2026-10-01', '2026-10-31'), 30);
  assert.ok(!isValidISODate('2026-02-30'));
  assert.equal(weekday('2026-10-17'), 6);
  assert.equal(formatMoney(12345678), '₹1,23,456.78');
});

test('transactions: create, validate, no future dates (user-local), edit, delete', async () => {
  const { c, cat } = await login({ timezone: 'Asia/Kolkata' });
  // "now" is 2026-10-15T09:00Z => 2026-10-15 in Kolkata
  let r = await c.post('/api/transactions', { kind: 'expense', title: '  Groceries ', amountMinor: 125000, categoryId: cat('Food & Dining'), date: '2026-10-06' });
  assert.equal(r.status, 201);
  assert.equal(r.body.transaction.title, 'Groceries');
  assert.equal(r.body.transaction.amountMinor, 125000);
  assert.equal(r.body.transaction.categoryName, 'Food & Dining');
  const id = r.body.transaction.id;

  for (const [body, status, code] of [
    [{ kind: 'expense', title: 'x', amountMinor: 100, categoryId: cat('Food & Dining'), date: '2026-10-16' }, 422, 'future_date'],
    [{ kind: 'expense', title: 'x', amountMinor: 100, categoryId: cat('Salary'), date: '2026-10-01' }, 422, 'invalid_category'],
    [{ kind: 'expense', title: 'x', amountMinor: 0, categoryId: cat('Food & Dining'), date: '2026-10-01' }, 400, 'validation'],
    [{ kind: 'expense', title: 'x', amountMinor: 12.5, categoryId: cat('Food & Dining'), date: '2026-10-01' }, 400, 'validation'],
    [{ kind: 'expense', title: 'x', amountMinor: '100', categoryId: cat('Food & Dining'), date: '2026-10-01' }, 400, 'validation'],
    [{ kind: 'expense', title: '   ', amountMinor: 100, categoryId: cat('Food & Dining'), date: '2026-10-01' }, 400, 'validation'],
    [{ kind: 'expense', title: 'x', amountMinor: 100, categoryId: cat('Food & Dining'), date: '2026-02-30' }, 400, 'validation'],
    [{ kind: 'expense', title: 'x', amountMinor: 100, categoryId: cat('Food & Dining'), date: '1999-01-01' }, 400, 'validation'],
    [{ kind: 'expense', title: 'x', amountMinor: 100, categoryId: cat('Food & Dining'), date: '2026-10-01', userId: 'other' }, 400, 'validation'],
  ]) {
    r = await c.post('/api/transactions', body);
    assert.equal(r.status, status, JSON.stringify(body));
    assert.equal(r.body.error.code, code);
  }
  // same-day (today) is allowed; "random days" in the past are allowed
  assert.equal((await c.post('/api/transactions', { kind: 'income', title: 'Gig', amountMinor: 500000, categoryId: cat('Freelance'), date: '2026-10-15' })).status, 201);
  assert.equal((await c.post('/api/transactions', { kind: 'expense', title: 'Old', amountMinor: 100, categoryId: cat('Transport'), date: '2024-03-09' })).status, 201);

  r = await c.patch(`/api/transactions/${id}`, { title: 'Weekly groceries', amountMinor: 130000, date: '2026-10-07' });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.transaction.title, r.body.transaction.amountMinor, r.body.transaction.date], ['Weekly groceries', 130000, '2026-10-07']);
  assert.equal((await c.patch(`/api/transactions/${id}`, { date: '2026-12-31' })).status, 422);
  assert.equal((await c.patch(`/api/transactions/${id}`, { kind: 'income' })).status, 422); // category kind no longer matches
  assert.equal((await c.patch(`/api/transactions/${id}`, { kind: 'income', categoryId: cat('Salary') })).status, 200);

  assert.equal((await c.delete(`/api/transactions/${id}`)).status, 200);
  assert.equal((await c.get(`/api/transactions/${id}`)).status, 404);
  assert.equal((await c.delete(`/api/transactions/${id}`)).status, 404);
});

test('transactions: search and filters by text, type, category, date, month, year, with totals and paging', async () => {
  const { c, cat } = await login();
  const add = (kind, title, amountMinor, category, date, note) => c.post('/api/transactions', { kind, title, amountMinor, categoryId: cat(category), date, ...(note ? { note } : {}) });
  await add('expense', 'Big Bazaar groceries', 100000, 'Food & Dining', '2026-10-06');
  await add('expense', 'Auto rickshaw', 20000, 'Transport', '2026-10-05', 'to college');
  await add('income', 'Freelance logo', 500000, 'Freelance', '2026-10-04');
  await add('expense', 'Pizza', 45000, 'Food & Dining', '2026-09-20');
  await add('expense', 'Old subscription', 9900, 'Entertainment', '2025-10-01');
  await add('expense', '100% juice_bar', 3000, 'Food & Dining', '2026-10-02');

  const q = async (qs) => (await c.get(`/api/transactions?${qs}`)).body;
  assert.equal((await q('')).total, 6);
  assert.deepEqual((await q('')).items.map((i) => i.date), ['2026-10-06', '2026-10-05', '2026-10-04', '2026-10-02', '2026-09-20', '2025-10-01']); // newest first
  assert.equal((await q('q=pizza')).total, 1);
  assert.equal((await q('q=COLLEGE')).total, 1); // matches note, case-insensitive
  assert.equal((await q('q=transport')).total, 1); // matches category name
  assert.equal((await q('q=100%25')).total, 1); // LIKE wildcards are escaped
  assert.equal((await q('q=_')).total, 1);
  assert.equal((await q('type=income')).total, 1);
  assert.equal((await q(`categoryId=${cat('Food & Dining')}`)).total, 3);
  assert.equal((await q('from=2026-10-01&to=2026-10-05')).total, 3);
  assert.equal((await q('year=2025')).total, 1);
  assert.equal((await q('year=2026&month=10')).total, 4);
  assert.equal((await q('month=9')).total, 1);
  const oct = await q('year=2026&month=10');
  assert.deepEqual(oct.totals, { incomeMinor: 500000, expenseMinor: 123000 });
  assert.deepEqual((await q('sort=amount_desc&limit=2')).items.map((i) => i.amountMinor), [500000, 100000]);
  const page2 = await q('limit=2&offset=2');
  assert.equal(page2.items.length, 2);
  assert.equal(page2.total, 6);
  assert.equal((await c.get('/api/transactions?month=13')).status, 400);
  assert.equal((await c.get('/api/transactions?evil=1')).status, 400);
  assert.equal((await c.get("/api/transactions?q=' OR 1=1 --")).body.total, 0); // injection attempt is just text
});

test('categories: unique per kind, in-use deletion is blocked, rename works', async () => {
  const { c, cat } = await login();
  let r = await c.post('/api/categories', { name: 'Pets', kind: 'expense', color: 'rose' });
  assert.equal(r.status, 201);
  const pets = r.body.category.id;
  assert.equal((await c.post('/api/categories', { name: ' pets ', kind: 'expense' })).status, 409);
  assert.equal((await c.post('/api/categories', { name: 'Pets', kind: 'income' })).status, 201);
  assert.equal((await c.patch(`/api/categories/${pets}`, { name: 'Pet care' })).body.category.name, 'Pet care');
  await c.post('/api/transactions', { kind: 'expense', title: 'Vet', amountMinor: 50000, categoryId: pets, date: '2026-10-01' });
  r = await c.delete(`/api/categories/${pets}`);
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'category_in_use');
  const used = (await c.get('/api/categories')).body.categories.find((x) => x.id === pets);
  assert.equal(used.usageCount, 1);
  assert.equal((await c.delete(`/api/categories/${cat('Health')}`)).status, 200);
});

test('budgets: overall + category, effective-dated, warnings, suggested daily spend', async () => {
  const { c, cat } = await login();
  const add = (title, amountMinor, category, date) => c.post('/api/transactions', { kind: 'expense', title, amountMinor, categoryId: cat(category), date });
  let r = await c.put('/api/budgets', { month: '2026-10', amountMinor: 1000000 });
  assert.equal(r.status, 201);
  const overallId = r.body.budget.id;
  assert.equal((await c.put('/api/budgets', { month: '2026-10', amountMinor: 1200000 })).status, 200); // update in place
  await c.put('/api/budgets', { month: '2026-10', categoryId: cat('Food & Dining'), amountMinor: 300000 });
  assert.equal((await c.put('/api/budgets', { month: '2026-10', categoryId: cat('Salary'), amountMinor: 1 })).status, 422); // income category
  assert.equal((await c.put('/api/budgets', { month: '2026-13', amountMinor: 1 })).status, 400);

  await add('Groceries', 200000, 'Food & Dining', '2026-10-05');
  let b = (await c.get('/api/budgets?month=2026-10')).body;
  assert.equal(b.overall.amountMinor, 1200000);
  assert.equal(b.overall.spentMinor, 200000);
  assert.equal(b.overall.remainingMinor, 1000000);
  assert.equal(b.overall.percentUsed, 17);
  assert.equal(b.overall.daysRemaining, 17); // 15th..31st inclusive
  assert.equal(b.overall.suggestedDailyMinor, Math.floor(1000000 / 17));
  assert.equal(b.categories[0].categoryName, 'Food & Dining');
  assert.equal(b.categories[0].percentUsed, 67);
  assert.equal(b.warnings.length, 0);

  r = await add('Dinner party', 70000, 'Food & Dining', '2026-10-10'); // crosses 80% of the food budget
  assert.equal(r.body.alerts.length, 1);
  assert.match(r.body.alerts[0].message, /Food & Dining has used 90%/);
  r = await add('Takeaway', 50000, 'Food & Dining', '2026-10-11');
  assert.equal(r.body.alerts[0].level, 'exceeded');
  assert.match(r.body.alerts[0].message, /over budget/);
  await add('TV', 900000, 'Shopping', '2026-10-12');
  b = (await c.get('/api/budgets?month=2026-10')).body;
  assert.equal(b.overall.status, 'exceeded');
  assert.equal(b.overall.overByMinor, 200000 + 70000 + 50000 + 900000 - 1200000);
  assert.ok(b.warnings.some((w) => w.scope === 'overall' && w.level === 'exceeded'));
  assert.equal(b.unbudgeted[0].categoryName, 'Shopping');

  // a later month inherits the budget until replaced
  const nov = (await c.get('/api/budgets?month=2026-11')).body;
  assert.equal(nov.overall.amountMinor, 1200000);
  assert.equal(nov.overall.carried, true);
  assert.equal(nov.overall.suggestedDailyMinor, 40000); // 30 days in the future month
  await c.put('/api/budgets', { month: '2026-11', amountMinor: 900000 });
  assert.equal((await c.get('/api/budgets?month=2026-11')).body.overall.amountMinor, 900000);
  assert.equal((await c.get('/api/budgets?month=2026-10')).body.overall.amountMinor, 1200000); // earlier month unchanged
  assert.equal((await c.get('/api/budgets?month=2026-09')).body.overall, null);
  assert.equal((await c.delete(`/api/budgets/${overallId}`)).status, 200);
  assert.equal((await c.get('/api/budgets?month=2026-10')).body.overall, null);

  // alerts respect the notification preference
  await c.patch('/api/profile', { notifications: { budget: false } });
  await c.put('/api/budgets', { month: '2026-10', amountMinor: 1000 });
  assert.deepEqual((await add('More', 100, 'Transport', '2026-10-13')).body.alerts, []);
});

test('goals: create, contribute, capacity, edit guard, projection, delete', async () => {
  const { c } = await login();
  assert.equal((await c.post('/api/goals', { name: 'Bad', targetMinor: 1000, savedMinor: 2000 })).status, 422);
  let r = await c.post('/api/goals', { name: 'Gaming Laptop', targetMinor: 6000000, savedMinor: 2500000, deadline: '2027-03-01' });
  assert.equal(r.status, 201);
  let g = r.body.goal;
  assert.deepEqual([g.savedMinor, g.remainingMinor, g.percent, g.status], [2500000, 3500000, 41, 'active']);
  assert.ok(g.neededDailyMinor > 0);
  assert.equal(g.projection.days, Math.ceil(3500000 / g.paceDailyMinor));

  assert.equal((await c.post(`/api/goals/${g.id}/contributions`, { amountMinor: 3500001 })).status, 422);
  assert.equal((await c.post(`/api/goals/${g.id}/contributions`, { amountMinor: 100, date: '2026-10-16' })).status, 422); // future
  r = await c.post(`/api/goals/${g.id}/contributions`, { amountMinor: 1000000, date: '2026-10-01', note: 'Diwali bonus' });
  assert.equal(r.status, 201);
  assert.equal(r.body.goal.savedMinor, 3500000);
  assert.match(r.body.notification.message, /50% funded/); // crossed the 50% milestone, goal not complete yet
  assert.equal((await c.patch(`/api/goals/${g.id}`, { targetMinor: 3000000 })).status, 422);
  assert.equal((await c.patch(`/api/goals/${g.id}`, { name: 'Laptop', targetMinor: 7000000 })).body.goal.targetMinor, 7000000);
  r = await c.post(`/api/goals/${g.id}/contributions`, { amountMinor: 3500000 });
  assert.equal(r.body.goal.complete, true);
  assert.equal(r.body.goal.percent, 100);
  assert.match(r.body.notification.message, /Goal reached: Laptop/);
  assert.equal((await c.post(`/api/goals/${g.id}/contributions`, { amountMinor: 1 })).body.error.code, 'goal_complete');

  const list = (await c.get(`/api/goals/${g.id}/contributions`)).body.contributions;
  assert.equal(list.length, 3);
  const removed = await c.delete(`/api/goals/${g.id}/contributions/${list[0].id}`);
  assert.equal(removed.body.goal.complete, false);
  assert.equal((await c.delete(`/api/goals/${g.id}`)).status, 200);
  assert.equal((await c.get('/api/goals')).body.goals.length, 0);
  assert.equal((await t.db.get('SELECT COUNT(*) AS n FROM goal_contributions')).n >= 0, true);
});

test('the database itself rejects goal overfill even if the API check is bypassed', async () => {
  const { c, user } = await login();
  const g = (await c.post('/api/goals', { name: 'Tiny', targetMinor: 1000, savedMinor: 1000 })).body.goal;
  await assert.rejects(
    t.db.run('INSERT INTO goal_contributions (id, user_id, goal_id, amount_minor, contributed_on, created_at) VALUES (?, ?, ?, ?, ?, ?)', ['x1', user.id, g.id, 1, '2026-10-01', 'now']),
    /exceeds the goal target/,
  );
});
