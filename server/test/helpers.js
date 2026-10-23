import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { createApp } from '../src/app.js';

export class Client {
  constructor(base) { this.base = base; this.cookie = ''; }
  async req(method, path, body, headers = {}) {
    const res = await fetch(this.base + path, {
      method,
      headers: {
        'x-requested-with': 'aurora-finsight',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    for (const c of setCookie) {
      const pair = c.split(';')[0];
      if (/Max-Age=0/i.test(c)) this.cookie = ''; else this.cookie = pair;
    }
    const text = await res.text();
    let json; try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
    return { status: res.status, body: json, text, headers: res.headers, setCookie };
  }
  get(p, h) { return this.req('GET', p, undefined, h); }
  post(p, b = {}, h) { return this.req('POST', p, b, h); }
  put(p, b = {}, h) { return this.req('PUT', p, b, h); }
  patch(p, b = {}, h) { return this.req('PATCH', p, b, h); }
  delete(p, b, h) { return this.req('DELETE', p, b, h); }
}

/** Boots the whole API on an ephemeral port with an in-memory database. */
export async function startTestServer({ now = new Date('2026-10-15T09:00:00Z'), env = {} } = {}) {
  const state = { now };
  const config = loadConfig({ DATABASE_URL: 'sqlite::memory:', SCRYPT_N: '1024', NODE_ENV: 'test', CLIENT_DIR: '/nonexistent', ...env });
  const db = await openDatabase(config.databaseUrl);
  await migrate(db);
  const errors = [];
  const app = createApp({ db, config, clock: () => state.now, log: (...a) => errors.push(a) });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    app, db, config, base, state, errors,
    client: () => new Client(base),
    setNow(d) { state.now = new Date(d); },
    resetLimits() { Object.values(app.ctx.limiters).forEach((l) => l.reset?.()); },
    async close() { Object.values(app.ctx.limiters).forEach((l) => l.stop?.()); await new Promise((r) => server.close(r)); await db.close(); },
  };
}

let counter = 0;
export async function registerUser(client, overrides = {}) {
  counter += 1;
  const body = { name: `User ${counter}`, email: `user${counter}@example.com`, password: 'Sup3rSecret!', timezone: 'Asia/Kolkata', ...overrides };
  const res = await client.post('/api/auth/register', body);
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${res.text}`);
  return { ...res.body.user, password: body.password, email: body.email };
}
