// Pure financial rules shared by the services (and unit tested on their own).
import { addDays, daysInMonth, diffDays, monthEnd, monthStart } from './dates.js';

/** Percent of a goal complete; never shows 100 until it truly is. */
export function goalPercent(saved, target) {
  if (target <= 0) return 0;
  if (saved >= target) return 100;
  return Math.min(99, Math.floor((saved * 100) / target));
}

/**
 * Budget maths for one month. `today` is the user's local ISO date.
 * suggestedDaily spreads what is left over the remaining days (including
 * today) for the current month, over the whole month for a future month,
 * and is 0 for a finished month.
 */
export function budgetStatus({ budgetMinor, spentMinor, month, today }) {
  const first = monthStart(month);
  const last = monthEnd(month);
  let daysRemaining;
  let phase;
  if (today < first) { phase = 'future'; daysRemaining = daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1); }
  else if (today > last) { phase = 'past'; daysRemaining = 0; }
  else { phase = 'current'; daysRemaining = diffDays(today, last) + 1; }

  const remaining = budgetMinor - spentMinor;
  const percentUsed = budgetMinor > 0 ? Math.round((spentMinor * 100) / budgetMinor) : 0;
  let status = 'none';
  if (budgetMinor > 0) {
    if (spentMinor > budgetMinor) status = 'exceeded';
    else if (spentMinor === budgetMinor) status = 'reached';
    else if (percentUsed >= 80) status = 'warning';
    else status = 'ok';
  }
  const suggestedDailyMinor = budgetMinor > 0 && remaining > 0 && daysRemaining > 0 ? Math.floor(remaining / daysRemaining) : 0;
  return { remainingMinor: remaining, overByMinor: Math.max(0, spentMinor - budgetMinor), percentUsed, status, phase, daysRemaining, suggestedDailyMinor };
}

/** Days elapsed in `month` up to today (full month if finished, 0 if future). */
export function daysElapsed(month, today) {
  const first = monthStart(month);
  const last = monthEnd(month);
  if (today < first) return 0;
  if (today > last) return daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1);
  return diffDays(first, today) + 1;
}

export const LEVEL_RANK = { none: 0, ok: 0, warning: 1, reached: 2, exceeded: 3 };

export { addDays };
