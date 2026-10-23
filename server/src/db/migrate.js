import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Apply any SQL files in db/migrations/<dialect>/ that have not run yet. */
export async function migrate(db, { log = () => {} } = {}) {
  const dir = path.join(here, 'migrations', db.dialect);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set((await db.all('SELECT name FROM schema_migrations')).map((r) => r.name));
  const applied = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.run('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', [file, new Date().toISOString()]);
    });
    log(`applied ${file}`);
    applied.push(file);
  }
  return applied;
}
