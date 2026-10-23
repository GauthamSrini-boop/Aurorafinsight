import express from 'express';
import { badRequest, conflict, forbidden, unauthorized } from '../lib/errors.js';
import { validate, schemas } from '../lib/schemas.js';
import { hashPassword, passwordPolicyError, verifyPassword } from '../lib/password.js';
import { parseCookies, serializeCookie } from '../lib/cookies.js';
import { isValidTimeZone } from '../lib/dates.js';
import { createUser, findUserByEmail, findUserById, userToJSON } from '../services/users.js';
import { createSession, destroySession, resolveSession } from '../services/sessions.js';
import { createRateLimiter } from '../middleware/rateLimit.js';

const FAILED_LOGIN = 'Incorrect email or password.';

export function authRoutes({ db, config, clock, limiters }) {
  const router = express.Router();

  limiters.login = createRateLimiter({
    windowMs: 15 * 60_000, max: 8, message: 'Too many login attempts. Please wait a few minutes and try again.',
    key: (req) => `${req.ip}|${String(req.body?.email || '').toLowerCase()}`,
  });
  limiters.loginIp = createRateLimiter({
    windowMs: 15 * 60_000, max: 60, message: 'Too many login attempts from this network. Please try again later.', key: (req) => req.ip,
  });
  limiters.register = createRateLimiter({
    windowMs: 60 * 60_000, max: 15, message: 'Too many sign-ups from this network. Please try again later.', key: (req) => req.ip,
  });

  let dummyHash;
  const dummy = async () => { dummyHash ||= await hashPassword('timing-equaliser-1', config.scryptN); return dummyHash; };

  const setCookie = (res, token) => res.append('Set-Cookie', serializeCookie(config.cookieName, token, {
    maxAgeSeconds: config.sessionTtlDays * 86_400, secure: config.cookieSecure,
  }));
  const clearCookie = (res) => res.append('Set-Cookie', serializeCookie(config.cookieName, '', { maxAgeSeconds: 0, secure: config.cookieSecure }));

  router.post('/register', limiters.register, async (req, res) => {
    if (!config.registrationOpen) throw forbidden('Registration is currently closed.');
    const body = validate(schemas.register, req.body);
    const policy = passwordPolicyError(body.password);
    if (policy) throw badRequest(policy, { password: policy });
    if (await findUserByEmail(db, body.email)) throw conflict('An account with this email already exists.', 'email_taken');
    const passwordHash = await hashPassword(body.password, config.scryptN); // before the DB transaction
    let userId;
    try {
      userId = await createUser(db, { name: body.name, email: body.email, passwordHash, timezone: isValidTimeZone(body.timezone) ? body.timezone : 'UTC' }, clock());
    } catch (e) {
      if (/UNIQUE|unique/.test(String(e.message))) throw conflict('An account with this email already exists.', 'email_taken');
      throw e;
    }
    const token = await createSession(db, userId, { ttlDays: config.sessionTtlDays, userAgent: req.get('user-agent'), now: clock() });
    setCookie(res, token);
    res.status(201).json({ user: userToJSON(await findUserById(db, userId)) });
  });

  router.post('/login', limiters.loginIp, limiters.login, async (req, res) => {
    const body = validate(schemas.login, req.body);
    const user = await findUserByEmail(db, body.email);
    const ok = await verifyPassword(body.password, user ? user.password_hash : await dummy());
    if (!user || !ok) throw unauthorized(FAILED_LOGIN);
    limiters.login.reset(`${req.ip}|${body.email}`);
    const token = await createSession(db, user.id, { ttlDays: config.sessionTtlDays, userAgent: req.get('user-agent'), now: clock() });
    setCookie(res, token);
    res.json({ user: userToJSON(user) });
  });

  router.post('/logout', async (req, res) => {
    const token = parseCookies(req.get('cookie'))[config.cookieName];
    const found = await resolveSession(db, token, { ttlDays: config.sessionTtlDays, now: clock() });
    if (found) await destroySession(db, found.sessionId);
    clearCookie(res);
    res.json({ ok: true });
  });

  router.get('/me', async (req, res) => {
    const token = parseCookies(req.get('cookie'))[config.cookieName];
    const found = await resolveSession(db, token, { ttlDays: config.sessionTtlDays, now: clock() });
    if (!found) throw unauthorized();
    res.json({ user: userToJSON(found.user) });
  });

  return router;
}
