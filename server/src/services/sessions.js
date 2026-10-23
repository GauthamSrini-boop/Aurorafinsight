import { createHash, randomBytes } from 'node:crypto';

const hash = (token) => createHash('sha256').update(token).digest('hex');
const DAY = 86_400_000;

export async function createSession(db, userId, { ttlDays, userAgent, now }) {
  const token = randomBytes(32).toString('base64url');
  const stamp = now.toISOString();
  await db.run(
    'INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
    [hash(token), userId, stamp, stamp, new Date(now.getTime() + ttlDays * DAY).toISOString(), String(userAgent || '').slice(0, 200)],
  );
  return token;
}

/** Returns { user, sessionId } for a valid token (sliding expiry), else null. */
export async function resolveSession(db, token, { ttlDays, now }) {
  if (!token || typeof token !== 'string' || token.length > 200) return null;
  const sessionId = hash(token);
  const row = await db.get(
    `SELECT s.id AS session_id, s.expires_at, s.last_seen_at, u.*
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    [sessionId],
  );
  if (!row) return null;
  if (row.expires_at <= now.toISOString()) {
    await db.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
    return null;
  }
  if (now.getTime() - new Date(row.last_seen_at).getTime() > 60 * 60 * 1000) {
    await db.run('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?',
      [now.toISOString(), new Date(now.getTime() + ttlDays * DAY).toISOString(), sessionId]);
  }
  const { session_id: _s, expires_at: _e, last_seen_at: _l, ...user } = row;
  return { user, sessionId };
}

export const destroySession = (db, sessionId) => db.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
export const destroyOtherSessions = (db, userId, keepId) => db.run('DELETE FROM sessions WHERE user_id = ? AND id <> ?', [userId, keepId]);
