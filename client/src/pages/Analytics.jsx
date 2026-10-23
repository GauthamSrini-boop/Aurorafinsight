import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';
import { useApi } from '../lib/useApi.js';
import { formatDate, monthLabel, monthOf, monthShort } from '../lib/dates.js';
import { Badge, Card, EmptyState, ErrorState, LoadingBlock, MonthPicker, PageHeader } from '../components/ui.jsx';
import { AreaChart, BarChart, Donut } from '../components/charts.jsx';
import { Icon } from '../components/Icon.jsx';
import { Change, Stat } from './Dashboard.jsx';

export function AnalyticsPage() {
  const { money, today } = useAuth();
  const [month, setMonth] = useState(monthOf(today));
  const year = month.slice(0, 4);
  const [categoryId, setCategoryId] = useState('');
  const cats = useApi(() => api.get('/categories'), []);
  const a = useApi(() => api.get(`/analytics?month=${month}${categoryId ? `&categoryId=${categoryId}` : ''}`), [month, categoryId]);
  const t = useApi(() => api.get(`/analytics/trends?year=${year}`), [year]);
  const fmt = (v, compact) => money(v, { compact });

  return (
    <>
      <PageHeader title="Spending analytics" subtitle="Category breakdowns, trends and comparisons from your transactions.">
        <div className="ffield inline-filter">
          <label htmlFor="an-cat" className="sr-only">Filter by category</label>
          <select id="an-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">All categories</option>
            {(cats.data?.categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <MonthPicker month={month} onChange={setMonth} max={monthOf(today)} />
      </PageHeader>
      {a.data?.filter && <p className="filter-note" role="status"><Icon name="search" size={15} /> Totals, daily chart and comparisons are limited to <b>{a.data.filter.categoryName}</b>. <button type="button" className="link-btn" onClick={() => setCategoryId('')}>Show all</button></p>}

      {a.loading && !a.data && <LoadingBlock rows={5} label="Loading analytics" />}
      {a.error && <ErrorState error={a.error} onRetry={a.reload} />}
      {a.data && (
        <div className={a.loading ? 'is-refreshing' : ''}>
          <div className="stats">
            <Stat label="Spent" icon="down" value={money(a.data.totals.expenseMinor)} sub={<Change percent={a.data.comparison.expenseChangePercent} inverse />} />
            <Stat label="Income" icon="up" value={money(a.data.totals.incomeMinor)} sub={<Change percent={a.data.comparison.incomeChangePercent} />} />
            <Stat label="Average daily spend" icon="calendar" value={money(a.data.averageDailySpendMinor)} sub={<span className="muted">over {a.data.daysElapsed} day{a.data.daysElapsed === 1 ? '' : 's'}</span>} />
            <Stat label={a.data.phase === 'current' ? 'Projected month total' : 'Month total'} icon="bolt" value={money(a.data.projectedMonthEndMinor)}
              sub={<span className="muted">{a.data.phase === 'current' ? 'if you keep this pace' : 'final'}</span>} />
          </div>

          {a.data.totals.count === 0 ? (
            <Card><EmptyState icon="chart" title={`No transactions in ${monthLabel(month)}`}>Pick another month or add transactions to see your breakdown.</EmptyState></Card>
          ) : (
            <>
              <div className="grid-main">
                <Card title="Category breakdown" subtitle={`Share of ${monthLabel(month)} spending`}>
                  {a.data.breakdown.length === 0 ? <EmptyState icon="chart" title="No expenses this month" /> : (
                    <Donut format={fmt} ariaLabel="Spending by category" centerLabel="Spent" centerValue={money(a.data.totals.expenseMinor, { compact: true })}
                      items={a.data.breakdown.map((c) => ({ id: c.categoryId, label: c.name, value: c.totalMinor, color: c.color }))} />
                  )}
                </Card>
                <Card title="Vs last month" subtitle={`Compared with ${monthLabel(shiftBack(month))}`}>
                  {a.data.breakdown.length === 0 ? <p className="muted">Nothing to compare.</p> : (
                    <ul className="compare">
                      {a.data.breakdown.map((c) => (
                        <li key={c.categoryId}>
                          <span className="dot" style={{ background: `var(--c-${c.color})` }} aria-hidden="true" />
                          <span className="compare-name">{c.name}</span>
                          <span className="compare-val">{money(c.totalMinor)}</span>
                          {c.changePercent === null ? <Badge>new</Badge> : <Badge tone={c.changePercent > 0 ? 'danger' : c.changePercent < 0 ? 'success' : 'neutral'}>{c.changePercent > 0 ? '+' : ''}{c.changePercent}%</Badge>}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>

              <Card title="Daily spending" subtitle={monthLabel(month)}>
                <AreaChart format={fmt} ariaLabel={`Daily spending in ${monthLabel(month)}`}
                  points={a.data.daily.map((d) => ({ label: String(d.day), full: formatDate(d.date), value: d.expenseMinor }))} />
              </Card>

              <div className="grid-3-eq">
                <Card title="Weekdays vs weekends"><div className="kv"><span>Weekday average</span><strong>{money(a.data.weekdayAverageMinor)}</strong></div><div className="kv"><span>Weekend average</span><strong>{money(a.data.weekendAverageMinor)}</strong></div><p className="muted small">Average spent per day so far this month.</p></Card>
                <Card title="Busiest day">{a.data.topDay ? <><strong className="big">{money(a.data.topDay.expenseMinor)}</strong><p className="muted">on {formatDate(a.data.topDay.date)}</p></> : <p className="muted">No spending yet.</p>}</Card>
                <Card title="Largest expense">{a.data.largestExpense ? <><strong className="big">{money(a.data.largestExpense.amountMinor)}</strong><p className="muted">{a.data.largestExpense.title} · {formatDate(a.data.largestExpense.date)}</p></> : <p className="muted">No expenses yet.</p>}</Card>
              </div>
            </>
          )}
        </div>
      )}

      <Card title={`${year} trends`} subtitle="Monthly income and expenses">
        {t.loading && !t.data && <LoadingBlock rows={3} label="Loading trends" />}
        {t.error && <ErrorState error={t.error} onRetry={t.reload} />}
        {t.data && (
          <>
            <BarChart format={fmt} ariaLabel={`Monthly income and expenses in ${year}`}
              data={t.data.months.map((m) => ({ label: monthShort(m.month), full: monthLabel(m.month), income: m.incomeMinor, expense: m.expenseMinor }))} />
            <div className="trend-facts">
              <div><span>Total spent</span><strong>{money(t.data.totals.expenseMinor)}</strong></div>
              <div><span>Total income</span><strong>{money(t.data.totals.incomeMinor)}</strong></div>
              <div><span>Average month</span><strong>{money(t.data.averageMonthlyExpenseMinor)}</strong></div>
              <div><span>Highest month</span><strong>{t.data.highestMonth ? monthLabel(t.data.highestMonth) : '—'}</strong></div>
              <div><span>Lowest month</span><strong>{t.data.lowestMonth ? monthLabel(t.data.lowestMonth) : '—'}</strong></div>
            </div>
            {t.data.years.length > 0 && (
              <div className="years">
                <h3 className="subhead"><Icon name="history" size={16} /> Year by year</h3>
                <div className="table-wrap"><table className="table table-compact">
                  <thead><tr><th>Year</th><th className="num">Income</th><th className="num">Expenses</th><th className="num">Net</th></tr></thead>
                  <tbody>{t.data.years.map((y) => <tr key={y.year}><td>{y.year}</td><td className="num">{money(y.incomeMinor)}</td><td className="num">{money(y.expenseMinor)}</td><td className={`num ${y.netMinor >= 0 ? 'pos' : 'neg'}`}>{money(y.netMinor)}</td></tr>)}</tbody>
                </table></div>
              </div>
            )}
          </>
        )}
      </Card>
    </>
  );
}

function shiftBack(m) { const t = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 2; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; }
