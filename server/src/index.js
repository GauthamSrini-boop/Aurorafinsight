import { loadConfig } from './config.js';
import { openDatabase } from './db/index.js';
import { migrate } from './db/migrate.js';
import { createApp } from './app.js';

const config = loadConfig();
const db = await openDatabase(config.databaseUrl);
await migrate(db, { log: (m) => console.log(`[db] ${m}`) });

const app = createApp({ db, config });
const server = app.listen(config.port, config.host, () => {
  console.log(`Aurora FinSight listening on http://${config.host}:${config.port} (${config.nodeEnv})`);
});

const shutdown = (signal) => {
  console.log(`${signal} received, shutting down…`);
  server.close(async () => { await db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
