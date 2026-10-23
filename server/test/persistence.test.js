import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startTestServer, registerUser } from './helpers.js';

test('data and sessions survive a full server restart (file-backed SQLite)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-persist-'));
  const env = { DATABASE_URL: `sqlite:${path.join(dir, 'app.db')}` };
  let t;
  try {
    // first run: register, record data
    t = await startTestServer({ env });
    let c = t.client();
    const user = await registerUser(c);
    const cats = (await c.get('/api/categories')).body.categories;
    const food = cats.find((x) => x.kind === 'expense').id;
    assert.equal((await c.post('/api/transactions', { kind: 'expense', title: 'Persistent lunch', amountMinor: 45050, categoryId: food, date: '2026-10-10' })).status, 201);
    const goal = (await c.post('/api/goals', { name: 'Keep me', targetMinor: 100000 })).body.goal;
    assert.equal((await c.post(`/api/goals/${goal.id}/contributions`, { amountMinor: 2500, date: '2026-10-10' })).status, 201);
    assert.equal((await c.put('/api/budgets', { month: '2026-10', amountMinor: 900000 })).status, 201);
    const cookie = c.cookie;
    await t.close();
    t = null;

    // second run: brand-new process-level objects, same file
    t = await startTestServer({ env });
    c = t.client();
    c.cookie = cookie; // the old session cookie is still valid because sessions live in the database
    const me = await c.get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, user.email);
    const list = (await c.get('/api/transactions')).body;
    assert.equal(list.total, 1);
    assert.equal(list.items[0].title, 'Persistent lunch');
    assert.equal(list.items[0].amountMinor, 45050);
    assert.equal((await c.get('/api/goals')).body.goals[0].savedMinor, 2500);
    assert.equal((await c.get('/api/budgets?month=2026-10')).body.overall.amountMinor, 900000);
    // and a fresh login with the password still works
    const again = t.client();
    assert.equal((await again.post('/api/auth/login', { email: user.email, password: 'Sup3rSecret!' })).status, 200);
    await t.close();
    t = null;
  } finally {
    await t?.close().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
