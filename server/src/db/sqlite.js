import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * SQLite adapter (development). Uses Node's built-in node:sqlite, so there is
 * nothing native to compile. The interface is async to match the PostgreSQL
 * adapter; all SQL uses `?` placeholders.
 *
 * Transaction rule: do not await network/CPU work (e.g. password hashing)
 * inside db.transaction(); keep it to database calls so it stays atomic.
 */
export function openSqlite(url) {
  const target = url.replace(/^sqlite:/, '') || ':memory:';
  if (target !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
  const raw = new DatabaseSync(target);
  raw.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (target !== ':memory:') raw.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');

  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) { s = raw.prepare(sql); cache.set(sql, s); }
    return s;
  };
  const clean = (params) => params.map((p) => {
    if (p === undefined) throw new Error('undefined SQL parameter');
    return typeof p === 'boolean' ? (p ? 1 : 0) : p;
  });
  const plain = (row) => (row ? { ...row } : undefined);

  const ops = {
    dialect: 'sqlite',
    async get(sql, params = []) { return plain(stmt(sql).get(...clean(params))); },
    async all(sql, params = []) { return stmt(sql).all(...clean(params)).map(plain); },
    async run(sql, params = []) { const r = stmt(sql).run(...clean(params)); return { changes: Number(r.changes) }; },
    async exec(sql) { raw.exec(sql); },
  };

  let queue = Promise.resolve();
  return {
    ...ops,
    transaction(fn) {
      const job = queue.then(async () => {
        raw.exec('BEGIN IMMEDIATE');
        try {
          const result = await fn(ops);
          raw.exec('COMMIT');
          return result;
        } catch (e) {
          try { raw.exec('ROLLBACK'); } catch { /* already rolled back */ }
          throw e;
        }
      });
      queue = job.catch(() => {});
      return job;
    },
    async close() { raw.close(); },
  };
}
