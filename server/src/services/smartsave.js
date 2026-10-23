import { addMonths, daysInMonth, diffDays, monthOf, monthStart, weekday } from '../lib/dates.js';
import { formatMoney } from '../lib/money.js';
import { listGoals } from './goals.js';

const MIN_SPAN_DAYS = 14;
const MIN_EXPENSES = 10;
const WEEKEND_DAYS_PER_MONTH = 8.7;
const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const recs = (rows) => [...rows].sort((a, b) => b.a - a.a || (a.d < b.d ? 1 : -1)).slice(0, 5)
  .map((r) => ({ id: r.id, title: r.title, amountMinor: r.a, date: r.d, category: r.cname }));

/** Progress against the user's own monthly cap on flexible (discretionary) spending. */
function targetStatus(user, rows, month, baseMonths, today) {
  const raw = user.smartsave_target_minor;
  const flexNames = [...new Set(rows.filter((r) => r.flexible).map((r) => r.cname))];
  if (raw === null || raw === undefined) return null;
  const targetMinor = Number(raw);
  const monthsWithData = baseMonths.filter((m) => rows.some((r) => r.m === m));
  const flexIn = (m) => sum(rows.filter((r) => r.flexible && r.m === m).map((r) => r.a));
  const baselineMinor = monthsWithData.length ? Math.round(sum(monthsWithData.map(flexIn)) / monthsWithData.length) : null;
  const dim = daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1);
  const elapsed = Number(today.slice(8, 10));
  const spentMinor = flexIn(month);
  const projectedMinor = Math.round((spentMinor / elapsed) * dim);
  const reductionGoalMinor = baselineMinor === null ? null : Math.max(0, baselineMinor - targetMinor);
  const reductionSoFarMinor = baselineMinor === null ? null : baselineMinor - projectedMinor;
  return {
    targetMinor, baselineMinor, spentMinor, projectedMinor, remainingMinor: targetMinor - spentMinor,
    status: spentMinor > targetMinor ? 'exceeded' : projectedMinor > targetMinor ? 'at_risk' : 'on_track',
    reductionGoalMinor, reductionSoFarMinor,
    progressPercent: reductionGoalMinor > 0 ? Math.max(0, Math.min(100, Math.round((reductionSoFarMinor * 100) / reductionGoalMinor))) : null,
    flexibleCategories: flexNames,
    method: `Flexible spending this month so far (${elapsed} of ${dim} days), projected to month end, compared with your target; baseline = average flexible spending of your previous ${monthsWithData.length} month(s) with data.`,
  };
}

/**
 * SmartSave Predictor: a transparent rules engine over the user's own expense history.
 * Every suggestion carries the numbers it was based on (evidence) and the arithmetic (method).
 * Nothing is invented: with too little data it says so instead of guessing.
 */
export async function smartSave(db, user, today) {
  const fmt = (m) => formatMoney(m, user.currency);
  const month = monthOf(today);
  const baseMonths = [1, 2, 3].map((i) => addMonths(month, -i));
  const from = monthStart(baseMonths[2]);
  const rows = (await db.all(
    `SELECT t.id AS id, t.txn_date AS d, t.title, t.amount_minor AS a, t.category_id AS cid, c.name AS cname, c.flexible AS fx
       FROM transactions t JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
      WHERE t.user_id = ? AND t.kind = 'expense' AND t.txn_date >= ? AND t.txn_date <= ?`, [user.id, from, today]))
    .map((r) => ({ ...r, a: Number(r.a), m: monthOf(r.d), flexible: Number(r.fx) === 1 }));

  const first = rows.reduce((a, r) => (a === null || r.d < a ? r.d : a), null);
  const spanDays = first ? diffDays(first, today) + 1 : 0;
  const targetInfo = targetStatus(user, rows, month, baseMonths, today);
  const base = { target: targetInfo, generatedFor: today, currency: user.currency, window: { from, to: today }, expenseCount: rows.length, spanDays };
  if (spanDays < MIN_SPAN_DAYS || rows.length < MIN_EXPENSES) {
    return {
      ...base, status: 'insufficient_data', suggestions: [], totalPotentialMinor: 0,
      message: `SmartSave needs at least ${MIN_EXPENSES} expenses spread over ${MIN_SPAN_DAYS}+ days to say anything useful. You have ${rows.length} expense${rows.length === 1 ? '' : 's'} across ${spanDays} day${spanDays === 1 ? '' : 's'} so far.`,
      required: { expenses: MIN_EXPENSES, days: MIN_SPAN_DAYS },
    };
  }

  const baseSet = new Set(baseMonths);
  const monthsWithData = baseMonths.filter((m) => rows.some((r) => r.m === m));
  const nBase = monthsWithData.length;
  const confidenceFor = (n) => (nBase >= 3 && n >= 8 ? 'high' : nBase >= 2 && n >= 4 ? 'medium' : 'low');
  const out = [];
  const flagged = new Set();

  const dim = daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1);
  const elapsed = Number(today.slice(8, 10));
  const cats = new Map();
  for (const r of rows) {
    const c = cats.get(r.cid) ?? { id: r.cid, name: r.cname, flexible: r.flexible, cur: 0, base: 0, n: 0 };
    if (r.m === month) c.cur += r.a; else if (baseSet.has(r.m)) c.base += r.a;
    c.n += 1; cats.set(r.cid, c);
  }

  // 1. Category running above its own baseline
  if (nBase >= 2 && elapsed >= 7) {
    for (const c of cats.values()) {
      const baseline = Math.round(c.base / nBase);
      const projected = Math.round((c.cur / elapsed) * dim);
      const over = projected - baseline;
      if (baseline > 0 && projected > baseline * 1.2 && over > 0 && c.cur > 0) {
        flagged.add(c.id);
        out.push({
          id: `overspend:${c.id}`, type: 'category_overspend', title: `${c.name} is running above your usual`,
          summary: `At this pace ${c.name} will reach about ${fmt(projected)} this month, versus your usual ${fmt(baseline)}. Bringing it back to normal would save about ${fmt(over)}.`,
          monthlyImpactMinor: over, confidence: confidenceFor(c.n), _rows: rows.filter((r) => r.cid === c.id && r.m === month),
          evidence: [`Spent so far this month on ${c.name}: ${fmt(c.cur)} in ${elapsed} days`, `Average of your previous ${nBase} month${nBase > 1 ? 's' : ''}: ${fmt(baseline)}`, `Projected month total: ${fmt(projected)}`],
          method: `projected = spent so far ÷ ${elapsed} days × ${dim} days; saving = projected − baseline (triggers when projected is >20% above baseline).`,
        });
      }
    }
  }

  // 2. Trim flexible categories by 10%
  const monthsSpan = Math.max(1, nBase + (rows.some((r) => r.m === month) ? 1 : 0));
  for (const c of [...cats.values()].filter((x) => x.flexible && !flagged.has(x.id))) {
    const avg = Math.round((c.base + c.cur) / monthsSpan);
    const save = Math.round(avg * 0.1);
    if (save > 0 && c.n >= 3) {
      out.push({
        id: `trim:${c.id}`, type: 'trim_flexible', title: `Trim ${c.name} by 10%`,
        summary: `${c.name} is discretionary and averages ${fmt(avg)} a month. A 10% trim frees about ${fmt(save)} a month.`,
        monthlyImpactMinor: save, confidence: confidenceFor(c.n), _rows: rows.filter((r) => r.cid === c.id),
        evidence: [`${c.n} ${c.name} expenses in your history`, `Average monthly ${c.name} spend: ${fmt(avg)} over ${monthsSpan} month${monthsSpan > 1 ? 's' : ''}`],
        method: 'saving = 10% × average monthly spend in categories you marked as flexible.',
      });
    }
  }

  // 3 & 4. Frequent small purchases and recurring charges, grouped by title
  const byTitle = new Map();
  for (const r of rows) { const k = norm(r.title); const g = byTitle.get(k) ?? { title: r.title, items: [] }; g.items.push(r); byTitle.set(k, g); }
  const medAll = median(rows.map((r) => r.a));
  for (const g of byTitle.values()) {
    const amounts = g.items.map((i) => i.a);
    const total = sum(amounts);
    if (g.items.length >= 6 && median(amounts) <= medAll) {
      const monthly = Math.round(total / monthsSpan);
      const save = Math.round(monthly * 0.25);
      if (save > 0) out.push({
        id: `frequent:${norm(g.title)}`, type: 'small_frequent', title: `"${g.title}" adds up`,
        summary: `You logged "${g.title}" ${g.items.length} times, about ${fmt(monthly)} a month. Cutting a quarter of those would save about ${fmt(save)} a month.`,
        monthlyImpactMinor: save, confidence: confidenceFor(g.items.length), _rows: g.items,
        evidence: [`${g.items.length} purchases totalling ${fmt(total)}`, `Typical amount: ${fmt(Math.round(median(amounts)))} (all expenses: ${fmt(Math.round(medAll))})`],
        method: `monthly = total ÷ ${monthsSpan} month(s); saving = 25% of monthly (triggers for 6+ purchases of at-or-below-typical size).`,
      });
    }
    const months = new Set(g.items.map((i) => i.m));
    const med = median(amounts);
    if (months.size >= 3 && g.items.every((i) => Math.abs(i.a - med) <= med * 0.1)) {
      out.push({
        id: `recurring:${norm(g.title)}`, type: 'recurring_charge', title: `Review recurring charge: ${g.title}`,
        summary: `"${g.title}" appears in ${months.size} different months at about ${fmt(Math.round(med))} each. If you no longer use it, cancelling saves ${fmt(Math.round(med))} a month.`,
        monthlyImpactMinor: Math.round(med), confidence: 'medium', _rows: g.items,
        evidence: [`Charged in ${[...months].sort().join(', ')}`, `Every amount within 10% of ${fmt(Math.round(med))}`],
        method: 'saving = the monthly charge, if you cancel it (you decide whether it is still worth it).',
      });
    }
  }

  // 5. Weekend spending spike
  const perDay = new Map();
  for (const r of rows) perDay.set(r.d, (perDay.get(r.d) ?? 0) + r.a);
  let wkS = 0; let wkN = 0; let weS = 0; let weN = 0;
  for (let i = 0; i < spanDays; i += 1) {
    const d = addDaysLocal(first, i);
    const v = perDay.get(d) ?? 0; const w = weekday(d);
    if (w === 0 || w === 6) { weS += v; weN += 1; } else { wkS += v; wkN += 1; }
  }
  if (weN >= 4 && wkN >= 5 && wkS > 0) {
    const weAvg = weS / weN; const wkAvg = wkS / wkN;
    const excess = Math.round((weAvg - wkAvg * 1.25) * WEEKEND_DAYS_PER_MONTH);
    if (weAvg > wkAvg * 1.5 && excess > 0) out.push({
      id: 'weekend_spike', type: 'weekend_spike', title: 'Weekends cost you more',
      summary: `You spend about ${fmt(Math.round(weAvg))} per weekend day versus ${fmt(Math.round(wkAvg))} on weekdays. Keeping weekends within 25% of weekday spend would save about ${fmt(excess)} a month.`,
      monthlyImpactMinor: excess, confidence: weN >= 8 ? 'medium' : 'low', _rows: rows.filter((r) => [0, 6].includes(weekday(r.d))),
      evidence: [`${weN} weekend days averaged ${fmt(Math.round(weAvg))}`, `${wkN} weekdays averaged ${fmt(Math.round(wkAvg))}`],
      method: `saving = (weekend avg − 1.25 × weekday avg) × ${WEEKEND_DAYS_PER_MONTH} weekend days a month (triggers when weekend avg is >1.5× weekday avg).`,
    });
  }

  // 6. Low savings rate in the last full month with income
  const lastFull = baseMonths.find((m) => rows.some((r) => r.m === m));
  if (lastFull) {
    const inc = await db.get(`SELECT COALESCE(SUM(amount_minor), 0) AS s FROM transactions WHERE user_id = ? AND kind = 'income' AND substr(txn_date, 1, 7) = ?`, [user.id, lastFull]);
    const income = Number(inc.s); const spent = sum(rows.filter((r) => r.m === lastFull).map((r) => r.a));
    if (income > 0) {
      const rate = Math.round(((income - spent) * 100) / income); const gap = Math.round(income * 0.1) - (income - spent);
      if (rate < 10 && gap > 0) out.push({
        id: 'low_savings_rate', type: 'low_savings_rate', title: 'Your savings rate is under 10%',
        summary: `In ${lastFull} you kept ${rate}% of your income. Saving 10% would mean setting aside ${fmt(gap)} more a month.`,
        monthlyImpactMinor: gap, confidence: 'medium', _rows: rows.filter((r) => r.m === lastFull),
        evidence: [`Income ${lastFull}: ${fmt(income)}`, `Expenses ${lastFull}: ${fmt(spent)}`, `Savings rate: ${rate}%`],
        method: 'gap = 10% × income − (income − expenses), for the most recent month that has expenses and income.',
      });
    }
  }

  for (const s of out) { s.records = recs(s._rows ?? []); delete s._rows; }
  out.sort((a, b) => b.monthlyImpactMinor - a.monthlyImpactMinor || a.id.localeCompare(b.id));
  const total = sum(out.map((s) => s.monthlyImpactMinor));

  // 7. What the savings would mean for the user's goals
  const goals = (await listGoals(db, user.id, today)).filter((g) => !g.complete && !g.archived);
  if (goals.length && total > 0) {
    const g = [...goals].sort((a, b) => (a.deadline ?? '9999') .localeCompare(b.deadline ?? '9999') || a.remainingMinor - b.remainingMinor)[0];
    const extra = total / 30; const pace = g.paceDailyMinor;
    const now = pace > 0 ? Math.ceil(g.remainingMinor / pace) : null; const then = Math.ceil(g.remainingMinor / (pace + extra));
    out.push({
      id: `goal:${g.id}`, type: 'goal_impact', title: `Reach "${g.name}" sooner`,
      summary: now !== null
        ? `Putting these savings toward "${g.name}" could bring it about ${Math.max(0, now - then)} days closer (${then} days instead of ${now}).`
        : `You have not saved toward "${g.name}" recently. Directing these savings there could finish it in about ${then} days.`,
      monthlyImpactMinor: 0, confidence: 'low',
      evidence: [`Remaining: ${fmt(g.remainingMinor)}`, `Recent savings pace: ${fmt(pace)} a day`, `Possible extra: ${fmt(total)} a month`],
      method: 'days = remaining ÷ daily pace; "with savings" adds (total suggested savings ÷ 30) to the daily pace. Estimates overlap between suggestions, so treat as an upper bound.',
    });
  }

  return {
    ...base, status: 'ok', suggestions: out, totalPotentialMinor: total,
    note: 'Estimates come only from your own transactions and may overlap; they are suggestions, not guarantees.',
  };
}

function addDaysLocal(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
