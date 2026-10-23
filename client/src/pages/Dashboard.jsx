import { useState } from 'react';
import { Link } from '../lib/router.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import { useApi } from '../lib/useApi.js';
import { monthOf, monthShort, monthLabel, greeting, relativeDay } from '../lib/dates.js';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingBlock, MonthPicker, PageHeader, ProgressBar } from '../components/ui.jsx';
import { BarChart, Donut } from '../components/charts.jsx';
import { Icon } from '../components/Icon.jsx';
import { TransactionModal } from '../components/TransactionModal.jsx';

export function Stat({ label, value, sub, tone, icon }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ''}`}>
      <div className="stat-top"><span>{label}</span>{icon && <Icon name={icon} size={18} />}</div>
      <strong className="stat-value">{value}</strong>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Change({ percent, inverse = false }) {
  if (percent === null || percent === undefined) return <span className="muted">no data last month</span>;
  if (percent === 0) return <span className="muted">same as last month</span>;
  const up = percent > 0;
  const good = inverse ? !up : up;
  return <span className={good ? 'pos' : 'neg'}><Icon name={up ? 'up' : 'down'} size={14} /> {Math.abs(percent)}% vs last month</span>;
}

export function TxnItem({ t, today, money, onClick }) {
  const income = t.kind === 'income';
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className="txn" {...(onClick ? { type: 'button', onClick } : {})}>
      <span className="txn-icon" style={{ '--tint': `var(--c-${t.categoryColor || 'slate'})` }}><Icon name={income ? 'up' : 'down'} size={16} /></span>
      <span className="txn-main"><strong>{t.title}</strong><small>{t.categoryName} · {relativeDay(t.date, today)}</small></span>
      <span className={`txn-amt ${income ? 'pos' : ''}`}>{income ? '+' : '−'}{money(t.amountMinor)}</span>
    </Tag>
  );
}

export function DashboardPage() {
  const { user, money, today } = useAuth();
  const [month, setMonth] = useState(monthOf(today));
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { data, error, loading, reload } = useApi(() => api.get(`/dashboard?month=${month}`), [month]);
  const cats = useApi(() => api.get('/categories'), []);
  const fmt = (v, compact) => money(v, { compact });
  const refresh = async () => { setRefreshing(true); await Promise.all([reload({ silent: true }), cats.reload({ silent: true })]); setRefreshing(false); toast.info('Dashboard refreshed from the server.'); };

  return (
    <>
      <PageHeader title={`${greeting(user.timezone)}, ${user.name.split(' ')[0]}`} subtitle="Here is where your money stands.">
        <MonthPicker month={month} onChange={setMonth} max={monthOf(today)} />
        <Button variant="secondary" icon="history" onClick={refresh} loading={refreshing}>Refresh</Button>
        <Button icon="plus" onClick={() => setAdding(true)} disabled={!cats.data}>Add transaction</Button>
      </PageHeader>

      {loading && !data && <LoadingBlock rows={5} label="Loading dashboard" />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data && (
        <div className={loading ? 'is-refreshing' : ''}>
          {data.allTime.count === 0 ? (
            <Card><EmptyState icon="coins" title="Nothing here yet" action={<Button icon="plus" onClick={() => setAdding(true)}>Add your first transaction</Button>}>
              Add an income or expense and your balance, charts and insights will appear here, computed from your own records.</EmptyState></Card>
          ) : (
            <>
              <div className="stats">
                <Stat label="Total balance" icon="wallet" value={money(data.balanceMinor)} sub={<span className="muted">{data.openingBalanceMinor ? `Includes opening balance of ${money(data.openingBalanceMinor)}` : 'All income minus all expenses'}</span>} tone="hero" />
                <Stat label={`Income · ${monthLabel(month)}`} icon="up" value={money(data.totals.incomeMinor)} sub={<Change percent={data.comparison.incomeChangePercent} />} />
                <Stat label={`Expenses · ${monthLabel(month)}`} icon="down" value={money(data.totals.expenseMinor)} sub={<Change percent={data.comparison.expenseChangePercent} inverse />} />
                <Stat label="Savings rate" icon="coins" value={data.savingsRatePercent === null ? '—' : `${data.savingsRatePercent}%`}
                  sub={<span className="muted">{data.savingsRatePercent === null ? 'No income recorded this month' : `${money(data.totals.netMinor)} kept this month`}</span>} />
              </div>

              <div className="grid-main">
                <Card title={`${month.slice(0, 4)} overview`} subtitle="Income and expenses by month">
                  <BarChart height={250} format={fmt} ariaLabel={`Income and expenses by month, ${month.slice(0, 4)}`}
                    data={data.yearTrend.map((m) => ({ label: monthShort(m.month), full: monthLabel(m.month), income: m.incomeMinor, expense: m.expenseMinor }))} />
                </Card>
                <Card title="Where it went" subtitle={monthLabel(month)}>
                  {data.topCategories.length === 0 ? <EmptyState icon="chart" title="No expenses this month" /> : (
                    <Donut format={fmt} ariaLabel="Spending by category" centerLabel="Spent" centerValue={money(data.totals.expenseMinor, { compact: true })}
                      items={data.topCategories.map((c) => ({ id: c.categoryId, label: c.name, value: c.totalMinor, color: c.color }))} />
                  )}
                </Card>
              </div>

              <div className="grid-3">
                <Card title="Recent transactions" action={<Link to="/transactions" className="link">View all</Link>} className="span-2">
                  <div className="txn-list">{data.recent.map((t) => <TxnItem key={t.id} t={t} today={today} money={money} />)}</div>
                </Card>
                <div className="stack">
                  <Card title="Monthly budget" action={<Link to="/budgets" className="link">Manage</Link>}>
                    {data.budget.overall ? (
                      <>
                        <div className="split"><strong>{money(data.budget.overall.spentMinor)}</strong><span className="muted">of {money(data.budget.overall.amountMinor)}</span></div>
                        <ProgressBar percent={data.budget.overall.percentUsed} tone={toneFor(data.budget.overall.status)} label="Budget used" />
                        <p className="muted small">{data.budget.overall.status === 'exceeded' ? `Over by ${money(data.budget.overall.overByMinor)}` : `${money(data.budget.overall.remainingMinor)} left · ${data.budget.overall.percentUsed}% used`}</p>
                      </>
                    ) : <p className="muted small">No budget set for this month. <Link to="/budgets" className="link">Set one</Link></p>}
                    {data.budget.warnings.filter((w) => w.level !== 'info').slice(0, 2).map((w) => <p key={w.scope} className={`warn-line ${w.level}`}><Icon name="alert" size={15} /> {w.message}</p>)}
                  </Card>
                  <Card title="Savings goals" action={<Link to="/goals" className="link">Open</Link>}>
                    {data.goals.count === 0 ? <p className="muted small">No goals yet. <Link to="/goals" className="link">Create one</Link></p> : (
                      <>
                        {data.goals.items.map((g) => (
                          <div key={g.id} className="mini-goal">
                            <div className="split"><span>{g.name}</span><Badge tone="neutral">{g.percent}%</Badge></div>
                            <ProgressBar percent={g.percent} label={`${g.name} progress`} />
                            <small className="muted">{money(g.savedMinor)} of {money(g.targetMinor)}</small>
                          </div>
                        ))}
                        {data.goals.milestones?.length > 0 && (
                          <div className="milestones"><h4 className="subhead"><Icon name="target" size={14} /> Next milestones</h4>
                            {data.goals.milestones.map((m) => <p key={m.goalId} className="small"><b>{money(m.remainingMinor)}</b> more to reach {m.percent}% of {m.name}</p>)}</div>
                        )}
                        <p className="muted small">{data.goals.completed} of {data.goals.count} goals complete</p>
                      </>
                    )}
                  </Card>
                </div>
              </div>
            </>
          )}
        </div>
      )}
      {adding && cats.data && <TransactionModal categories={cats.data.categories} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload({ silent: true }); }} />}
    </>
  );
}

export const toneFor = (status) => (status === 'exceeded' ? 'danger' : status === 'reached' || status === 'warning' ? 'warning' : 'accent');
