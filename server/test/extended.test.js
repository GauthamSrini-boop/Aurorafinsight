import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, registerUser } from './helpers.js';

let t;
before(async () => { t = await startTestServer(); }); // today = 2026-10-15 (Asia/Kolkata)
after(async () => { await t.close(); });

async function login() {
  const c = t.client();
  const user = await registerUser(c);
  const cats = (await c.get('/api/categories')).body.categories;
  const cat = (name) => cats.find((x) => x.name === name).id;
  const add = async (kind, title, amountMinor, category, date, extra = {}) => {
    const r = await c.post('/api/transactions', { kind, title, amountMinor, categoryId: cat(category), date, ...extra });
    assert.equal(r.status, 201, r.text);
    return r.body.transaction;
  };
  return { c, user, cat, add };
}

test('transactions: payment method, amount-range and payment filters, validation', async () => {
  const { c, add, cat } = await login();
  const a = await add('expense', 'Lunch', 25000, 'Food & Dining', '2026-10-10', { paymentMethod: 'UPI' });
  await add('expense', 'Dinner', 90000, 'Food & Dining', '2026-10-11', { paymentMethod: 'Card' });
  await add('expense', 'Snack', 5000, 'Food & Dining', '2026-10-12');
  assert.equal(a.paymentMethod, 'UPI');
  const list = async (q) => (await c.get(`/api/transactions?${q}`)).body;
  assert.equal((await list('minAmount=20000&maxAmount=90000')).total, 2);
  assert.equal((await list('minAmount=90001')).total, 0);
  assert.equal((await list('maxAmount=5000')).items[0].title, 'Snack');
  assert.equal((await list('paymentMethod=upi')).total, 1);
  assert.equal((await list('q=card')).total, 1); // free text also searches payment method
  assert.equal((await c.get('/api/transactions?minAmount=500&maxAmount=100')).status, 400);
  assert.equal((await c.get('/api/transactions?minAmount=abc')).status, 400);
  const up = await c.patch(`/api/transactions/${a.id}`, { paymentMethod: 'Cash' });
  assert.equal(up.body.transaction.paymentMethod, 'Cash');
  assert.equal((await c.patch(`/api/transactions/${a.id}`, { paymentMethod: null })).body.transaction.paymentMethod, null);
  assert.equal((await c.post('/api/transactions', { kind: 'expense', title: 'x', amountMinor: 1, categoryId: cat('Food & Dining'), date: '2026-10-10', paymentMethod: 'x'.repeat(41) })).status, 400);
});

test('opening balance feeds the dashboard balance explicitly', async () => {
  const { c, add } = await login();
  assert.equal((await c.get('/api/dashboard')).body.balanceMinor, 0);
  const r = await c.patch('/api/profile', { openingBalanceMinor: 1_000_000 });
  assert.equal(r.body.user.openingBalanceMinor, 1_000_000);
  await add('income', 'Pay', 200000, 'Salary', '2026-10-01');
  await add('expense', 'Rent', 350000, 'Bills & Utilities', '2026-10-02');
  const d = (await c.get('/api/dashboard')).body;
  assert.equal(d.openingBalanceMinor, 1_000_000);
  assert.equal(d.balanceMinor, 1_000_000 + 200000 - 350000);
  assert.equal((await c.patch('/api/profile', { openingBalanceMinor: -50000 })).body.user.openingBalanceMinor, -50000); // overdrawn start is allowed
  assert.equal((await c.patch('/api/profile', { openingBalanceMinor: 1.5 })).status, 400);
  assert.equal((await c.patch('/api/profile', { openingBalanceMinor: 10 ** 12 })).status, 400);
});

test('goals: description, category, withdrawals, archive/restore, milestones', async () => {
  const { c } = await login();
  const g = (await c.post('/api/goals', { name: 'Bike', targetMinor: 100000, description: 'Commuter bike', category: 'Travel', savedMinor: 30000 })).body.goal;
  assert.deepEqual([g.description, g.category, g.savedMinor, g.archived], ['Commuter bike', 'Travel', 30000, false]);
  assert.deepEqual(g.nextMilestone, { percent: 50, remainingMinor: 20000 });

  // withdrawals reduce the saved amount and are validated
  let r = await c.post(`/api/goals/${g.id}/withdrawals`, { amountMinor: 10000, note: 'Repair' });
  assert.equal(r.status, 201);
  assert.equal(r.body.goal.savedMinor, 20000);
  assert.equal(r.body.contribution.kind, 'withdrawal');
  assert.equal((await c.post(`/api/goals/${g.id}/withdrawals`, { amountMinor: 20001 })).status, 422);
  assert.equal((await c.post(`/api/goals/${g.id}/withdrawals`, { amountMinor: 100, date: '2026-12-01' })).status, 422);
  // deposits are limited by the net amount still needed
  assert.equal((await c.post(`/api/goals/${g.id}/contributions`, { amountMinor: 80001 })).status, 422);
  r = await c.post(`/api/goals/${g.id}/contributions`, { amountMinor: 80000 });
  assert.equal(r.body.goal.complete, true);
  assert.match(r.body.notification.message, /Goal reached: Bike/);
  // withdrawing from a completed goal reopens it
  assert.equal((await c.post(`/api/goals/${g.id}/withdrawals`, { amountMinor: 5000 })).body.goal.complete, false);

  // history shows both kinds; removing a deposit that later withdrawals depend on is refused
  const hist = (await c.get(`/api/goals/${g.id}/contributions`)).body.contributions;
  assert.deepEqual([...new Set(hist.map((h) => h.kind))].sort(), ['deposit', 'withdrawal']);
  const bigDeposit = hist.find((h) => h.kind === 'deposit' && h.amountMinor === 80000);
  const del = await c.delete(`/api/goals/${g.id}/contributions/${bigDeposit.id}`);
  assert.equal(del.status, 200); // 95000 saved − 80000 = 15000, still ≥ 0
  const rest = (await c.get(`/api/goals/${g.id}`)).body.goal;
  assert.equal(rest.savedMinor, 15000);
  const opening = hist.find((h) => h.note === 'Opening balance');
  assert.equal((await c.delete(`/api/goals/${g.id}/contributions/${opening.id}`)).status, 422); // would leave −15000

  // edit text fields; archive/restore
  const ed = await c.patch(`/api/goals/${g.id}`, { description: null, category: 'Transport' });
  assert.deepEqual([ed.body.goal.description, ed.body.goal.category], [null, 'Transport']);
  const arch = await c.patch(`/api/goals/${g.id}`, { archived: true });
  assert.equal(arch.body.goal.archived, true);
  assert.equal(arch.body.goal.status, 'archived');
  assert.equal((await c.post(`/api/goals/${g.id}/contributions`, { amountMinor: 100 })).status, 422);
  assert.equal((await c.post(`/api/goals/${g.id}/withdrawals`, { amountMinor: 100 })).status, 422);
  const dash = (await c.get('/api/dashboard')).body;
  assert.equal(dash.goals.count, 0); // archived goals are out of the overview
  assert.equal((await c.get('/api/goals')).body.goals.length, 1); // but still listed for restore
  const back = await c.patch(`/api/goals/${g.id}`, { archived: false });
  assert.equal(back.body.goal.archived, false);
  assert.equal((await c.get('/api/dashboard')).body.goals.count, 1);
  assert.equal((await c.get('/api/dashboard')).body.goals.milestones[0].goalId, g.id);
  assert.equal((await c.post(`/api/goals/${g.id}/contributions`, { amountMinor: 100 })).status, 201);

  // goal with deposits + withdrawals can still be deleted (cascade) and the database enforces withdrawal limits itself
  const row = await t.db.get('SELECT user_id FROM goals WHERE id = ?', [g.id]);
  await assert.rejects(() => t.db.run(
    "INSERT INTO goal_contributions (id, user_id, goal_id, amount_minor, contributed_on, kind, created_at) VALUES ('x1', ?, ?, 99999999, '2026-10-01', 'withdrawal', 't')", [row.user_id, g.id]), /withdrawal exceeds/);
  assert.equal((await c.delete(`/api/goals/${g.id}`)).status, 200);
  assert.equal(Number((await t.db.get('SELECT COUNT(*) AS n FROM goal_contributions WHERE goal_id = ?', [g.id])).n), 0);
});

test('goal progress notifications: milestones fire once per crossing and respect the preference', async () => {
  const { c } = await login();
  const g = (await c.post('/api/goals', { name: 'Phone', targetMinor: 100000 })).body.goal;
  const dep = async (amountMinor) => (await c.post(`/api/goals/${g.id}/contributions`, { amountMinor })).body.notification;
  assert.equal(await dep(10000), null);                                   // 10% — nothing yet
  assert.match((await dep(20000)).message, /Phone is 25% funded/);        // 30%
  assert.equal(await dep(5000), null);                                    // 35% — still past the same milestone
  assert.match((await dep(30000)).message, /50% funded/);                 // 65%
  assert.match((await dep(30000)).message, /75% funded/);                 // 95% (crossed 75)
  assert.match((await dep(5000)).message, /Goal reached: Phone!/);        // 100%
  await c.patch('/api/profile', { notifications: { goals: false } });
  const g2 = (await c.post('/api/goals', { name: 'Bag', targetMinor: 1000 })).body.goal;
  const quiet = await c.post(`/api/goals/${g2.id}/contributions`, { amountMinor: 1000 });
  assert.equal(quiet.body.notification, null);                            // preference off: no alert, goal still completes
  assert.equal(quiet.body.goal.complete, true);
});

test('analytics can be narrowed to one category; foreign categories are refused', async () => {
  const a = await login(); const b = await login();
  await a.add('expense', 'Groceries', 40000, 'Food & Dining', '2026-10-05');
  await a.add('expense', 'Bus', 10000, 'Transport', '2026-10-06');
  await a.add('expense', 'Groceries Sep', 20000, 'Food & Dining', '2026-09-05');
  const all = (await a.c.get('/api/analytics?month=2026-10')).body;
  const food = (await a.c.get(`/api/analytics?month=2026-10&categoryId=${a.cat('Food & Dining')}`)).body;
  assert.equal(all.totals.expenseMinor, 50000);
  assert.equal(food.totals.expenseMinor, 40000);
  assert.equal(food.previous.expenseMinor, 20000);
  assert.equal(food.comparison.expenseChangePercent, 100);
  assert.equal(food.filter.categoryName, 'Food & Dining');
  assert.equal(food.daily[4].expenseMinor, 40000);
  assert.equal(food.largestExpense.title, 'Groceries');
  assert.equal(food.breakdown.length, 2); // the breakdown keeps showing every category for context
  assert.equal((await b.c.get(`/api/analytics?categoryId=${a.cat('Food & Dining')}`)).status, 404);
});

test('SmartSave: user-defined target with progress, supporting records, per-user isolation', async () => {
  const a = await login(); const b = await login();
  // flexible categories by default: Food & Dining, Shopping, Entertainment, Other
  for (const m of ['07', '08', '09']) {
    await a.add('expense', `Eating out ${m}`, 60000, 'Food & Dining', `2026-${m}-10`);
    await a.add('expense', `Rent ${m}`, 100000, 'Bills & Utilities', `2026-${m}-02`); // not flexible
    await a.add('expense', `Movie ${m}`, 20000, 'Entertainment', `2026-${m}-15`);
  }
  await a.add('expense', 'Eating out Oct', 90000, 'Food & Dining', '2026-10-05');
  const none = (await a.c.get('/api/smartsave')).body;
  assert.equal(none.target, null);

  assert.equal((await a.c.put('/api/smartsave/target', { targetMinor: -1 })).status, 400);
  assert.equal((await a.c.put('/api/smartsave/target', { targetMinor: 'x' })).status, 400);
  const set = (await a.c.put('/api/smartsave/target', { targetMinor: 50000 })).body;
  const tg = set.target;
  assert.equal(tg.baselineMinor, 80000);            // (60000 + 20000) per previous month
  assert.equal(tg.spentMinor, 90000);                // Oct flexible spend so far
  assert.equal(tg.status, 'exceeded');
  assert.equal(tg.remainingMinor, -40000);
  assert.equal(tg.reductionGoalMinor, 30000);        // baseline 80000 → target 50000
  assert.equal(tg.projectedMinor, Math.round((90000 / 15) * 31));
  assert.equal(tg.reductionSoFarMinor, 80000 - tg.projectedMinor);
  assert.equal(tg.progressPercent, 0);               // projected is above the baseline, so no progress yet
  assert.deepEqual(tg.flexibleCategories.sort(), ['Entertainment', 'Food & Dining']);
  assert.equal((await a.c.get('/api/profile')).body.user.smartsaveTargetMinor, 50000);

  // easy target → on track
  const easy = (await a.c.put('/api/smartsave/target', { targetMinor: 900000 })).body.target;
  assert.equal(easy.status, 'on_track');
  // suggestions cite the actual transactions behind them
  const sug = (await a.c.get('/api/smartsave')).body.suggestions.filter((s) => s.type !== 'goal_impact');
  assert.ok(sug.length > 0);
  for (const s of sug) assert.ok(Array.isArray(s.records) && s.records.length > 0 && s.records.every((r) => r.id && r.title && r.amountMinor > 0 && r.date), s.id);
  const over = sug.find((s) => s.type === 'category_overspend');
  assert.ok(over.records.every((r) => r.date.startsWith('2026-10')));

  // clearing the target
  assert.equal((await a.c.put('/api/smartsave/target', { targetMinor: null })).body.target, null);

  // B is unaffected by A's target and cannot see A's records
  const bs = (await b.c.get('/api/smartsave')).body;
  assert.equal(bs.target, null);
  assert.equal((await b.c.get('/api/profile')).body.user.smartsaveTargetMinor, null);
});

test('new endpoints are isolated and authenticated', async () => {
  const a = await login(); const b = await login();
  const goal = (await a.c.post('/api/goals', { name: 'Private', targetMinor: 10000, savedMinor: 5000 })).body.goal;
  for (const [m, p, body] of [['post', `/api/goals/${goal.id}/withdrawals`, { amountMinor: 100 }], ['patch', `/api/goals/${goal.id}`, { archived: true }]]) {
    assert.equal((await b.c[m](p, body)).status, 404, `${m} ${p}`);
  }
  assert.equal((await a.c.get(`/api/goals/${goal.id}`)).body.goal.savedMinor, 5000);
  const anon = t.client();
  assert.equal((await anon.put('/api/smartsave/target', { targetMinor: 1 })).status, 401);
  assert.equal((await anon.post(`/api/goals/${goal.id}/withdrawals`, { amountMinor: 1 })).status, 401);
});
