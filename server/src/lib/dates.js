// Calendar dates are ISO strings (YYYY-MM-DD) everywhere; "today" is always
// computed in the user's own time zone so future-date checks are fair.
const pad = (n) => String(n).padStart(2, '0');

export function isValidTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return typeof tz === 'string' && tz.length <= 64;
  } catch {
    return false;
  }
}

export function todayIn(timeZone, now = new Date()) {
  const tz = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function daysInMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function isValidISODate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  return y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m - 1);
}

export function isValidMonth(v) {
  return typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) && Number(v.slice(0, 4)) >= 2000 && Number(v.slice(0, 4)) <= 2100;
}

export const parseDate = (iso) => ({ year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)), day: Number(iso.slice(8, 10)) });

const dayNumber = (iso) => {
  const { year, month, day } = parseDate(iso);
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
};

export const diffDays = (a, b) => dayNumber(b) - dayNumber(a);

export function addDays(iso, n) {
  const { year, month, day } = parseDate(iso);
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export const monthStart = (month) => `${month}-01`;
export const monthEnd = (month) => `${month}-${pad(daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1))}`;

export function addMonths(month, n) {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${pad(mm + 1)}`;
}

export const monthOf = (iso) => iso.slice(0, 7);
/** 0 = Sunday … 6 = Saturday */
export const weekday = (iso) => { const { year, month, day } = parseDate(iso); return new Date(Date.UTC(year, month - 1, day)).getUTCDay(); };
