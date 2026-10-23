import { unauthorized } from '../lib/errors.js';
import { parseCookies } from '../lib/cookies.js';
import { todayIn } from '../lib/dates.js';
import { resolveSession } from '../services/sessions.js';

/** Requires a valid session; sets req.user (DB row), req.sessionId and req.today. */
export function requireAuth({ db, config, clock }) {
  return async (req, res, next) => {
    const token = parseCookies(req.get('cookie'))[config.cookieName];
    const found = await resolveSession(db, token, { ttlDays: config.sessionTtlDays, now: clock() });
    if (!found) return next(unauthorized());
    req.user = found.user;
    req.sessionId = found.sessionId;
    req.today = todayIn(found.user.timezone, clock());
    return next();
  };
}
