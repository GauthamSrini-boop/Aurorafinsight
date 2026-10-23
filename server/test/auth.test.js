import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, registerUser } from './helpers.js';
import { hashPassword, verifyPassword, passwordPolicyError } from '../src/lib/password.js';

let t;
before(async () => { t = await startTestServer(); });
after(async () => { await t.close(); });

test('passwords are hashed with scrypt, salted, and verified in constant-time form', async () => {
  const a = await hashPassword('Sup3rSecret!', 1024);
  const b = await hashPassword('Sup3rSecret!', 1024);
  assert.notEqual(a, b); // unique salt
  assert.match(a, /^scrypt\$1024\$8\$1\$/);
  assert.ok(await verifyPassword('Sup3rSecret!', a));
  assert.ok(!(await verifyPassword('sup3rsecret!', a)));
  assert.ok(!(await verifyPassword('x', 'garbage')));
  assert.match(passwordPolicyError('short1'), /8 characters/);
  assert.match(passwordPolicyError('onlyletters'), /letter and one number/);
  assert.match(passwordPolicyError('password123'), /common/);
  assert.equal(passwordPolicyError('Sup3rSecret!'), '');
});

test('register creates a user, starter categories and a secure session cookie; password is never stored in plaintext', async () => {
  const c = t.client();
  const res = await c.post('/api/auth/register', { name: '  Asha   Rao ', email: 'Asha@Example.com', password: 'Sup3rSecret!', timezone: 'Asia/Kolkata' });
  assert.equal(res.status, 201);
  assert.equal(res.body.user.email, 'asha@example.com');
  assert.equal(res.body.user.name, 'Asha Rao');
  assert.equal(res.body.user.password_hash, undefined);
  assert.equal(JSON.stringify(res.body).includes('scrypt'), false);
  const cookie = res.setCookie[0];
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /aurora_sid=/);
  const row = await t.db.get('SELECT password_hash FROM users WHERE email = ?', ['asha@example.com']);
  assert.ok(row.password_hash.startsWith('scrypt$'));
  assert.ok(!row.password_hash.includes('Sup3rSecret'));
  const cats = await t.db.get('SELECT COUNT(*) AS n FROM categories WHERE user_id = ?', [res.body.user.id]);
  assert.equal(cats.n, 12);
  // the session id stored in the DB is a hash, not the cookie token
  const token = decodeURIComponent(res.setCookie[0].split(';')[0].split('=')[1]);
  assert.equal(await t.db.get('SELECT id FROM sessions WHERE id = ?', [token]), undefined);
});

test('register validation and duplicate emails', async () => {
  const c = t.client();
  let r = await c.post('/api/auth/register', { name: '', email: 'bad', password: 'x' });
  assert.equal(r.status, 400);
  assert.ok(r.body.error.fields.name || r.body.error.fields.email);
  r = await c.post('/api/auth/register', { name: 'A', email: 'a@b.co', password: 'alllowercase' });
  assert.equal(r.status, 400);
  assert.match(r.body.error.fields.password, /letter and one number/);
  r = await c.post('/api/auth/register', { name: 'A', email: 'a@b.co', password: 'Sup3rSecret!', isAdmin: true });
  assert.equal(r.status, 400); // unknown fields are rejected (mass-assignment guard)
  await registerUser(c, { email: 'dupe@example.com' });
  r = await t.client().post('/api/auth/register', { name: 'B', email: 'DUPE@example.com', password: 'Sup3rSecret!' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'email_taken');
});

test('login, session persistence, me, logout', async () => {
  const user = await registerUser(t.client(), { email: 'login@example.com' });
  const c = t.client();
  let r = await c.get('/api/auth/me');
  assert.equal(r.status, 401);
  r = await c.post('/api/auth/login', { email: 'LOGIN@example.com', password: user.password });
  assert.equal(r.status, 200);
  r = await c.get('/api/auth/me');
  assert.equal(r.body.user.email, 'login@example.com');
  r = await c.get('/api/profile');
  assert.equal(r.status, 200);
  r = await c.post('/api/auth/logout');
  assert.equal(r.status, 200);
  assert.equal((await c.get('/api/profile')).status, 401);
});

test('logout invalidates the server-side session, not just the cookie', async () => {
  const user = await registerUser(t.client(), { email: 'stolen@example.com' });
  const c = t.client();
  await c.post('/api/auth/login', { email: user.email, password: user.password });
  const stolen = c.cookie;
  await c.post('/api/auth/logout');
  const attacker = t.client();
  attacker.cookie = stolen;
  assert.equal((await attacker.get('/api/profile')).status, 401);
});

test('wrong password and unknown email give the same generic error', async () => {
  const user = await registerUser(t.client(), { email: 'generic@example.com' });
  const a = await t.client().post('/api/auth/login', { email: user.email, password: 'WrongPass1' });
  const b = await t.client().post('/api/auth/login', { email: 'nobody@example.com', password: 'WrongPass1' });
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.deepEqual(a.body, b.body);
});

test('login is rate limited and recovers after a successful login window reset', async () => {
  const user = await registerUser(t.client(), { email: 'brute@example.com' });
  const c = t.client();
  let last;
  for (let i = 0; i < 9; i += 1) last = await c.post('/api/auth/login', { email: user.email, password: 'WrongPass1' });
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get('retry-after')) > 0);
  // even the right password is refused while limited
  assert.equal((await c.post('/api/auth/login', { email: user.email, password: user.password })).status, 429);
  t.resetLimits();
});

test('expired sessions are rejected', async () => {
  const user = await registerUser(t.client(), { email: 'expire@example.com' });
  const c = t.client();
  await c.post('/api/auth/login', { email: user.email, password: user.password });
  assert.equal((await c.get('/api/profile')).status, 200);
  t.setNow('2026-12-15T09:00:00Z'); // > 14 days later
  assert.equal((await c.get('/api/profile')).status, 401);
  t.setNow('2026-10-15T09:00:00Z');
});

test('CSRF: state-changing requests need the custom header; foreign origins are blocked', async () => {
  const user = await registerUser(t.client(), { email: 'csrf@example.com' });
  const c = t.client();
  await c.post('/api/auth/login', { email: user.email, password: user.password });
  let r = await c.patch('/api/profile', { name: 'Hacked' }, { 'x-requested-with': '' });
  assert.equal(r.status, 403);
  r = await c.patch('/api/profile', { name: 'Hacked' }, { origin: 'https://evil.example' });
  assert.equal(r.status, 403);
  r = await c.patch('/api/profile', { name: 'Fine' }, { origin: new URL(t.base).origin });
  assert.equal(r.status, 200);
});

test('security headers and malformed input', async () => {
  const c = t.client();
  const r = await c.get('/api/health');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-powered-by'), null);
  const bad = await fetch(`${t.base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'aurora-finsight' }, body: '{not json' });
  assert.equal(bad.status, 400);
  const big = await c.post('/api/auth/login', { email: 'a@b.co', password: 'x'.repeat(200_000) });
  assert.equal(big.status, 413);
  assert.equal((await c.get('/api/nope')).status, 404);
  assert.equal(t.errors.length, 0); // no unexpected 500s
});

test('profile: update settings, change password revokes other sessions, delete account removes data', async () => {
  const user = await registerUser(t.client(), { email: 'profile@example.com' });
  const a = t.client();
  const b = t.client();
  await a.post('/api/auth/login', { email: user.email, password: user.password });
  await b.post('/api/auth/login', { email: user.email, password: user.password });

  let r = await a.patch('/api/profile', { name: 'New Name', currency: 'USD', theme: 'light', timezone: 'America/New_York', notifications: { tips: false } });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.user.currency, r.body.user.theme, r.body.user.name, r.body.user.notifications.tips, r.body.user.notifications.budget], ['USD', 'light', 'New Name', false, true]);
  assert.equal((await a.patch('/api/profile', { currency: 'JPY' })).status, 400);
  assert.equal((await a.patch('/api/profile', { timezone: 'Mars/Base' })).status, 400);
  assert.equal((await a.patch('/api/profile', { password_hash: 'x' })).status, 400);
  assert.equal((await a.patch('/api/profile', {})).status, 400);

  r = await a.post('/api/profile/password', { currentPassword: 'nope', newPassword: 'Another1Pass' });
  assert.equal(r.status, 400);
  r = await a.post('/api/profile/password', { currentPassword: user.password, newPassword: 'weak' });
  assert.equal(r.status, 400);
  r = await a.post('/api/profile/password', { currentPassword: user.password, newPassword: 'Another1Pass' });
  assert.equal(r.status, 200);
  assert.equal((await a.get('/api/profile')).status, 200); // current session survives
  assert.equal((await b.get('/api/profile')).status, 401); // other device signed out
  assert.equal((await t.client().post('/api/auth/login', { email: user.email, password: user.password })).status, 401);
  assert.equal((await t.client().post('/api/auth/login', { email: user.email, password: 'Another1Pass' })).status, 200);

  assert.equal((await a.delete('/api/profile', { password: 'wrong' })).status, 401);
  assert.equal((await a.delete('/api/profile', { password: 'Another1Pass' })).status, 200);
  assert.equal((await a.get('/api/profile')).status, 401);
  assert.equal((await t.db.get('SELECT COUNT(*) AS n FROM categories WHERE user_id = ?', [user.id])).n, 0);
  assert.equal((await t.db.get('SELECT COUNT(*) AS n FROM users WHERE id = ?', [user.id])).n, 0);
});
