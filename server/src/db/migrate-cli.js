import { loadConfig } from '../config.js';
import { openDatabase } from './index.js';
import { migrate } from './migrate.js';

const config = loadConfig();
const db = await openDatabase(config.databaseUrl);
const applied = await migrate(db, { log: (m) => console.log(m) });
console.log(applied.length ? `Done: ${applied.length} migration(s) applied.` : 'Database is up to date.');
await db.close();
