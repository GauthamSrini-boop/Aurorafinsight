const pad = (n) => String(n).padStart(2, '0');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Today's date (YYYY-MM-DD) in an IANA time zone — mirrors what the server uses for "no future dates". */
export function todayIn(timeZone, now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const get = (t) => parts.find((p) => p.type === t).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export const monthOf = (iso) => iso.slice(0, 7);
export function addMonths(month, n) {
  const total = Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}
export const monthName = (m) => MONTHS[Number(m.slice(5, 7)) - 1];
export const monthLabel = (m) => `${monthName(m)} ${m.slice(0, 4)}`;
export const monthShort = (m) => monthName(m).slice(0, 3);
export const MONTH_NAMES = MONTHS;

/** "2026-10-15" -> "15 Oct 2026" (no time-zone shifting: the string is parsed, not a Date). */
export function formatDate(iso, { year = true } = {}) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1].slice(0, 3)}${year ? ` ${y}` : ''}`;
}

export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function relativeDay(iso, today) {
  if (iso === today) return 'Today';
  if (iso === addDays(today, -1)) return 'Yesterday';
  return formatDate(iso, { year: iso.slice(0, 4) !== today.slice(0, 4) });
}

export function greeting(timeZone, now = new Date()) {
  let hour = 12;
  try { hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hour12: false }).format(now)) % 24; } catch { /* keep default */ }
  return hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}
