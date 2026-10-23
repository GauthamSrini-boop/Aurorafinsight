import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);
const KEYLEN = 64;
const R = 8;
const P = 1;

const COMMON = new Set([
  'password', 'password1', 'password12', 'password123', '12345678', '123456789', '1234567890', 'qwerty123', 'qwertyuiop',
  'iloveyou1', 'letmein123', 'welcome123', 'admin1234', 'abc12345', 'changeme123', 'passw0rd', 'p@ssw0rd', 'monkey123',
]);

/** Returns an error message, or '' if the password is acceptable. */
export function passwordPolicyError(password) {
  if (typeof password !== 'string') return 'Password is required.';
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (password.length > 128) return 'Password must be 128 characters or fewer.';
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return 'Password must include at least one letter and one number.';
  if (COMMON.has(password.toLowerCase())) return 'That password is too common. Choose something less guessable.';
  return '';
}

const maxmem = (N) => 128 * N * R * 2 + 1024 * 1024;

export async function hashPassword(password, N = 65536) {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: maxmem(N) });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const N = Number(n);
  if (!Number.isInteger(N) || N < 1024 || N > 1 << 20) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N, r: Number(r), p: Number(p), maxmem: maxmem(N),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
