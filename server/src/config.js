import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
const int = (v, fallback) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};

export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProd = nodeEnv === 'production';
  return {
    nodeEnv,
    isProd,
    port: int(env.PORT, 4000),
    host: env.HOST || '0.0.0.0',
    // sqlite:./data/aurora.db | sqlite::memory: | postgres://user:pass@host/db
    databaseUrl: env.DATABASE_URL || 'sqlite:./data/aurora.db',
    sessionTtlDays: int(env.SESSION_TTL_DAYS, 14),
    cookieName: env.COOKIE_NAME || 'aurora_sid',
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : isProd,
    trustProxy: env.TRUST_PROXY === 'true',
    allowedOrigins: list(env.ALLOWED_ORIGINS),
    clientDir: env.CLIENT_DIR || path.resolve(here, '../../client/dist'),
    registrationOpen: env.REGISTRATION_OPEN !== 'false',
    scryptN: int(env.SCRYPT_N, 65536),
    logRequests: env.LOG_REQUESTS ? env.LOG_REQUESTS === 'true' : !isProd ? false : true,
  };
}
