/**
 * PostgreSQL adapter (production). Same interface as the SQLite adapter.
 * `?` placeholders are rewritten to $1, $2, …; BIGINT columns are returned as
 * numbers (amounts are far below 2^53). Requires the `pg` package.
 */
const toPg = (sql) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };

export async function openPostgres(url, { poolSize = 10, ssl } = {}) {
  const pg = (await import('pg')).default;
  pg.types.setTypeParser(20, (v) => Number(v)); // int8
  pg.types.setTypeParser(1700, (v) => Number(v)); // numeric (SUM of bigint)
  const pool = new pg.Pool({ connectionString: url, max: poolSize, ssl });

  const make = (client) => ({
    dialect: 'postgres',
    async get(sql, params = []) { return (await client.query(toPg(sql), params)).rows[0]; },
    async all(sql, params = []) { return (await client.query(toPg(sql), params)).rows; },
    async run(sql, params = []) { const r = await client.query(toPg(sql), params); return { changes: r.rowCount }; },
    async exec(sql) { await client.query(sql); },
  });

  return {
    ...make(pool),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(make(client));
        await client.query('COMMIT');
        return result;
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch { /* ignore */ }
        throw e;
      } finally {
        client.release();
      }
    },
    async close() { await pool.end(); },
  };
}
