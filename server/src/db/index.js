import { openSqlite } from './sqlite.js';

/** Open the database named by DATABASE_URL (sqlite:… or postgres://…). */
export async function openDatabase(url) {
  if (/^postgres(ql)?:\/\//.test(url)) {
    const { openPostgres } = await import('./postgres.js');
    return openPostgres(url);
  }
  if (url.startsWith('sqlite:')) return openSqlite(url);
  throw new Error(`Unsupported DATABASE_URL "${url.split(':')[0]}:…". Use sqlite:… or postgres://…`);
}
