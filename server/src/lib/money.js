const LOCALES = { INR: 'en-IN', USD: 'en-US', EUR: 'en-IE', GBP: 'en-GB' };
const cache = new Map();

/** 125050 -> "₹1,250.50", 125000 -> "₹1,250". Amounts are integer minor units. */
export function formatMoney(minor, currency = 'INR') {
  const code = LOCALES[currency] ? currency : 'INR';
  if (!cache.has(code)) {
    cache.set(code, new Intl.NumberFormat(LOCALES[code], { style: 'currency', currency: code }));
  }
  const value = (Number.isFinite(minor) ? minor : 0) / 100;
  const text = cache.get(code).format(value);
  return Number.isInteger(value) ? text.replace(/[.,]00$/, '') : text;
}

/** Integer percentage, rounded half up; 0 when total is 0. */
export const percentOf = (part, total) => (total > 0 ? Math.round((part * 100) / total) : 0);
