// Money is always an integer number of minor units (paise/cents). Parsing is done on the
// text itself, never through floating point, so "0.1 + 0.2" style errors cannot occur.

export const MAX_MINOR = 100_000_000_000;
const LOCALES = { INR: 'en-IN', USD: 'en-US', EUR: 'en-IE', GBP: 'en-GB' };
export const CURRENCIES = [
  { code: 'INR', label: 'Indian Rupee (₹)' }, { code: 'USD', label: 'US Dollar ($)' },
  { code: 'EUR', label: 'Euro (€)' }, { code: 'GBP', label: 'British Pound (£)' },
];

/** "1,234.50" -> { minor: 123450 }; anything invalid -> { error }. */
export function parseAmount(input) {
  if (input === null || input === undefined) return { error: 'Enter an amount.' };
  let s = String(input).trim().replace(/[₹$€£\s]/g, '');
  if (!s) return { error: 'Enter an amount.' };
  if (s.startsWith('-')) return { error: 'Amount must be greater than 0.' };
  if (/,/.test(s) && !/^\d{1,3}(,\d{2,3})*(\.\d*)?$/.test(s)) return { error: 'Use commas only as thousands separators, e.g. 1,250.50.' };
  s = s.replace(/,/g, '');
  if (!/^\d*\.?\d*$/.test(s) || s === '.') return { error: 'Enter a valid number, e.g. 250 or 250.50.' };
  const [whole = '0', frac = ''] = s.split('.');
  if (frac.length > 2) return { error: 'Use at most 2 decimal places.' };
  const minor = Number(whole || '0') * 100 + Number(frac.padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(minor)) return { error: 'Amount is too large.' };
  if (minor <= 0) return { error: 'Amount must be greater than 0.' };
  if (minor > MAX_MINOR) return { error: 'Amount is too large.' };
  return { minor };
}

/** Like parseAmount but 0 is allowed (e.g. "already saved"); empty means 0. */
export function parseOptionalAmount(input) {
  if (input === '' || input === null || input === undefined) return { minor: 0 };
  const s = String(input).trim().replace(/[₹$€£\s,]/g, '');
  if (/^0*\.?0*$/.test(s)) return { minor: 0 };
  return parseAmount(input);
}

/** Like parseOptionalAmount but allows a leading minus (e.g. an overdrawn opening balance). Empty means 0. */
export function parseSignedAmount(input) {
  const s = String(input ?? '').trim();
  const negative = s.startsWith('-');
  const r = parseOptionalAmount(negative ? s.slice(1) : s);
  if (r.error) return r;
  return { minor: negative ? -r.minor : r.minor };
}

/** 123450 -> "1234.50" (for editing in a text field). */
export function minorToInput(minor) {
  const abs = Math.abs(minor);
  return `${minor < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

const cache = new Map();
function formatter(currency) {
  if (!cache.has(currency)) cache.set(currency, new Intl.NumberFormat(LOCALES[currency] ?? 'en-US', { style: 'currency', currency }));
  return cache.get(currency);
}

const symbols = new Map();
function symbolOf(currency) {
  if (!symbols.has(currency)) {
    const parts = new Intl.NumberFormat(LOCALES[currency] ?? 'en-US', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).formatToParts(0);
    symbols.set(currency, parts.find((p) => p.type === 'currency')?.value ?? currency);
  }
  return symbols.get(currency);
}

/** ₹12.5K / ₹3.2L / ₹1.4Cr for rupees, $12.5K / $3.2M elsewhere — short, unambiguous labels for chart axes. */
export function compactMoney(minor, currency = 'INR') {
  const value = (Number(minor) || 0) / 100;
  const abs = Math.abs(value);
  const units = currency === 'INR'
    ? [[1e7, 'Cr'], [1e5, 'L'], [1e3, 'K']]
    : [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  const trim = (n) => String(Math.round(n * 10) / 10);
  const sign = value < 0 ? '-' : '';
  for (const [size, suffix] of units) if (abs >= size) return `${sign}${symbolOf(currency)}${trim(abs / size)}${suffix}`;
  return `${sign}${symbolOf(currency)}${trim(abs)}`;
}

export function formatMoney(minor, currency = 'INR', { compact = false } = {}) {
  if (compact) return compactMoney(minor, currency);
  const value = (Number(minor) || 0) / 100;
  const text = formatter(currency).format(value);
  // Whole amounts read cleaner without ".00" (₹500, not ₹500.00); fractional ones keep two decimals.
  return Number.isInteger(value) ? text.replace(/\.00$/, '') : text;
}

export const percent = (part, total) => (total > 0 ? Math.round((part * 100) / total) : 0);
