import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Banknote,
  Car,
  Circle,
  CreditCard,
  Heart,
  Music,
  PieChart as PieChartIcon,
  Plus,
  ShoppingBag,
  Sparkles,
  Target,
  UtensilsCrossed,
  Wallet,
} from 'lucide-react';
import apiClient from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useDisplayCurrency } from '../currency/CurrencyContext';
import { extractError, formatCurrency } from '../lib/format';
import DashboardSkeleton from '../components/skeletons/DashboardSkeleton';
import AreaChartCard from '../components/charts/AreaChartCard';
import DonutChart from '../components/charts/DonutChart';
import StatCard from '../components/ui/StatCard';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import useSnapshots from '../hooks/useSnapshots';
import useWindowSize from '../hooks/useWindowSize';

/**
 * Dashboard / financial-snapshot view.
 *
 * Existing data: `GET /networth?currency=` (net worth + breakdown) and the
 * shared `useSnapshots` hook (30-day history). The redesigned layout also
 * surfaces this month's income/expenses, recent transactions, budget health,
 * and upcoming bills — read-only data pulled additively below; no existing
 * data flow was modified.
 */

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Time-of-day greeting. */
function greetingFor(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Short "12 Jun" date. */
function shortDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** Whole days from today until a due date (negative = overdue). */
function daysUntil(dueDate) {
  if (!dueDate) return Number.POSITIVE_INFINITY;
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return Number.POSITIVE_INFINITY;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(due);
  d.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86400000);
}

/** Map a transaction category to an icon + accent color. */
function categoryVisual(category, type) {
  const c = String(category || '').toLowerCase();
  if (type === 'income' || c.includes('salary') || c.includes('income'))
    return { Icon: Banknote, color: '#16a34a' };
  if (c.includes('food') || c.includes('grocery') || c.includes('restaurant'))
    return { Icon: UtensilsCrossed, color: '#f59e0b' };
  if (c.includes('transport') || c.includes('fuel') || c.includes('travel') || c.includes('car'))
    return { Icon: Car, color: '#06b6d4' };
  if (c.includes('shop') || c.includes('cloth'))
    return { Icon: ShoppingBag, color: '#a78bfa' };
  if (c.includes('health') || c.includes('medical'))
    return { Icon: Heart, color: '#ef4444' };
  if (c.includes('entertain') || c.includes('music') || c.includes('movie'))
    return { Icon: Music, color: '#f59e0b' };
  return { Icon: Circle, color: '#a1a1aa' };
}

/* ── Small shared building blocks ──────────────────────────────────────────*/

function SectionCard({ children, style }) {
  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: 20,
        boxShadow: 'var(--shadow-sm)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function SectionHeader({ title, subtitle, actionLabel, onAction }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 16,
      }}
    >
      <div>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</div>
        {subtitle && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>
        )}
      </div>
      {actionLabel && (
        <button
          type="button"
          onClick={onAction}
          style={{
            fontSize: 13,
            color: 'var(--accent)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            padding: 0,
          }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function EmptyBlock({ icon: Icon, title, subtitle, actionLabel, onAction }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 6,
        padding: '32px 0',
      }}
    >
      {Icon && <Icon size={40} strokeWidth={1.5} color="var(--text-muted)" />}
      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)', marginTop: 4 }}>
        {title}
      </div>
      {subtitle && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{subtitle}</div>}
      {actionLabel && (
        <div style={{ marginTop: 8 }}>
          <Button variant="ghost" size="sm" onClick={onAction}>
            {actionLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { displayCurrency, format } = useDisplayCurrency();
  const { user } = useAuth();
  const { isMobile } = useWindowSize();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Net worth (existing flow — unchanged).
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { data: payload } = await apiClient.get('/networth', {
          params: { currency: displayCurrency },
        });
        if (!cancelled) setData(payload);
      } catch (err) {
        if (!cancelled) setError(extractError(err, 'Unable to load net worth'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [displayCurrency]);

  const { snapshots, loading: snapshotsLoading } = useSnapshots();

  // Additive, read-only data for the redesigned sections.
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const [extra, setExtra] = useState({
    transactions: [],
    incomeRows: [],
    expenseRows: [],
    budgets: [],
    bills: [],
  });
  const [extraLoading, setExtraLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function loadExtra() {
      setExtraLoading(true);
      try {
        const [txRes, summaryRes, budgetRes, billRes] = await Promise.all([
          apiClient.get('/transactions', { params: { month, year } }),
          apiClient.get('/transactions/summary', { params: { month, year } }),
          apiClient.get('/budgets', { params: { month, year } }),
          apiClient.get('/bills'),
        ]);
        if (cancelled) return;
        setExtra({
          transactions: Array.isArray(txRes.data) ? txRes.data : [],
          incomeRows: summaryRes.data?.income ?? [],
          expenseRows: summaryRes.data?.expense ?? [],
          budgets: Array.isArray(budgetRes.data) ? budgetRes.data : [],
          bills: Array.isArray(billRes.data) ? billRes.data : [],
        });
      } catch {
        // Non-fatal — sections fall back to their empty states.
        if (!cancelled) {
          setExtra({ transactions: [], incomeRows: [], expenseRows: [], budgets: [], bills: [] });
        }
      } finally {
        if (!cancelled) setExtraLoading(false);
      }
    }
    loadExtra();
    return () => {
      cancelled = true;
    };
  }, [month, year]);

  const currency = data?.displayCurrency ?? displayCurrency;
  const firstName = user?.name ? String(user.name).trim().split(/\s+/)[0] : '';

  if (loading) return <DashboardSkeleton />;

  // Derived figures for the redesigned sections.
  const totalIncome = extra.incomeRows.reduce((s, x) => s + Number(x.total || 0), 0);
  const totalExpense = extra.expenseRows.reduce((s, x) => s + Number(x.total || 0), 0);
  const savingsRate =
    totalIncome > 0 ? Math.round(((totalIncome - totalExpense) / totalIncome) * 100) : 0;

  // Net-worth change over the snapshot window (base INR → display via format()).
  const nwChange =
    snapshots.length >= 2
      ? Number(snapshots[snapshots.length - 1].netWorth) - Number(snapshots[0].netWorth)
      : 0;

  const spendData = extra.expenseRows
    .filter((r) => Number(r.total) > 0)
    .map((r) => ({ name: r.category, value: Number(r.total), amount: Number(r.total) }));

  const recentTx = [...extra.transactions]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5);

  const budgetRows = extra.budgets.slice(0, 4);

  const upcomingBills = extra.bills
    .filter((b) => !b.isPaid)
    .sort((a, b) => new Date(a.nextDueDate) - new Date(b.nextDueDate))
    .slice(0, 4);

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* SECTION 1 — Header */}
      <div style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontSize: 24,
            fontWeight: 700,
            color: 'var(--text-primary)',
            letterSpacing: '-0.3px',
          }}
        >
          {greetingFor()}{firstName ? `, ${firstName}` : ''} 👋
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
          Here is your financial snapshot for today
        </p>
      </div>

      {error && (
        <p
          role="alert"
          style={{
            background: 'var(--red-muted)',
            color: 'var(--red)',
            borderRadius: 'var(--radius-md)',
            padding: '8px 12px',
            fontSize: 13,
            marginBottom: 20,
          }}
        >
          {error}
        </p>
      )}

      {data && (
        <>
          {/* SECTION 2 — Net worth hero */}
          <div
            style={{
              position: 'relative',
              overflow: 'hidden',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-xl)',
              padding: 28,
              marginBottom: 20,
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                top: -40,
                right: -40,
                width: 200,
                height: 200,
                borderRadius: '50%',
                background: 'var(--accent-muted)',
                pointerEvents: 'none',
                zIndex: 0,
              }}
            />
            <div
              style={{
                position: 'relative',
                zIndex: 1,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 20,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: 'var(--text-muted)',
                    marginBottom: 8,
                  }}
                >
                  Total Net Worth
                </div>
                <div
                  style={{
                    fontSize: 40,
                    fontWeight: 700,
                    letterSpacing: '-1px',
                    fontVariantNumeric: 'tabular-nums',
                    lineHeight: 1,
                    color: data.netWorth >= 0 ? 'var(--green)' : 'var(--red)',
                  }}
                >
                  {formatCurrency(data.netWorth, currency)}
                </div>
                {snapshots.length >= 2 && (
                  <div style={{ marginTop: 12 }}>
                    <Badge variant={nwChange >= 0 ? 'success' : 'danger'}>
                      {nwChange >= 0 ? '+' : '-'}
                      {format(Math.abs(nwChange))} this month
                    </Badge>
                  </div>
                )}
              </div>

              {!isMobile && snapshots.length >= 2 && (
                <div style={{ width: 200, opacity: 0.8, pointerEvents: 'none' }}>
                  <AreaChartCard
                    data={snapshots}
                    dataKey="netWorth"
                    xKey="label"
                    height={80}
                    card={false}
                    sparkline
                  />
                </div>
              )}
            </div>
          </div>

          {/* SECTION 3 — Three stat cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
              gap: 16,
              marginBottom: 20,
            }}
          >
            <StatCard
              label="Income This Month"
              value={extraLoading ? '—' : format(totalIncome)}
              icon={ArrowDownLeft}
              iconColor="var(--green)"
              valueColor="var(--green)"
              trendLabel={`${MONTH_NAMES[month - 1]} ${year}`}
            />
            <StatCard
              label="Expenses This Month"
              value={extraLoading ? '—' : format(totalExpense)}
              icon={ArrowUpRight}
              iconColor="var(--red)"
              valueColor="var(--red)"
              trendLabel={`${MONTH_NAMES[month - 1]} ${year}`}
            />
            <StatCard
              label="Savings Rate"
              value={extraLoading ? '—' : `${savingsRate}%`}
              icon={Wallet}
              iconColor="var(--accent)"
              valueColor="var(--accent)"
              trendLabel="of income saved"
            />
          </div>

          {/* SECTION 4 — Net worth trend chart */}
          <SectionCard style={{ marginBottom: 20 }}>
            <SectionHeader title="Net Worth — Last 30 Days" subtitle="Your financial trajectory" />
            {snapshotsLoading ? (
              <div style={{ height: isMobile ? 180 : 240 }} />
            ) : snapshots.length >= 2 ? (
              <AreaChartCard
                data={snapshots}
                dataKey="netWorth"
                xKey="label"
                height={isMobile ? 180 : 240}
                card={false}
              />
            ) : (
              <EmptyBlock
                icon={ArrowLeftRight}
                title="Not enough history yet"
                subtitle="Your net-worth trend appears after a few days of activity"
              />
            )}
          </SectionCard>

          {/* Net worth composition — assets vs liabilities breakdown */}
          <SectionCard style={{ marginBottom: 20 }}>
            <SectionHeader title="Net worth" subtitle="What it's made of" />
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
                gap: 20,
              }}
            >
              <BreakdownList
                heading="Assets"
                items={data.assets || []}
                valueKey="value"
                currency={currency}
                emptyText="No assets yet."
              />
              <BreakdownList
                heading="Liabilities"
                items={data.liabilities || []}
                valueKey="amount"
                currency={currency}
                emptyText="No liabilities yet."
              />
            </div>
          </SectionCard>

          {/* SECTION 5 — Two columns: spending donut + recent transactions */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : '3fr 2fr',
              gap: 20,
              marginBottom: 20,
            }}
          >
            <SectionCard>
              <SectionHeader
                title="Spending by Category"
                subtitle={`${MONTH_NAMES[month - 1]} ${year}`}
              />
              {extraLoading ? (
                <div style={{ height: isMobile ? 200 : 240 }} />
              ) : spendData.length > 0 && totalExpense > 0 ? (
                <DonutChart
                  data={spendData}
                  height={isMobile ? 200 : 240}
                  centerValue={format(totalExpense)}
                  centerLabel="Spent"
                  valueFormatter={(n) => format(n)}
                />
              ) : (
                <EmptyBlock
                  icon={PieChartIcon}
                  title="No spending data yet"
                  subtitle="Add transactions to see your breakdown"
                  actionLabel="Add transaction"
                  onAction={() => navigate('/transactions')}
                />
              )}
            </SectionCard>

            <SectionCard>
              <SectionHeader
                title="Recent Transactions"
                actionLabel="See all"
                onAction={() => navigate('/transactions')}
              />
              {extraLoading ? (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '16px 0' }}>
                  Loading…
                </div>
              ) : recentTx.length === 0 ? (
                <EmptyBlock icon={ArrowLeftRight} title="No transactions yet" />
              ) : (
                <div>
                  {recentTx.map((tx, idx) => {
                    const { Icon, color } = categoryVisual(tx.category, tx.type);
                    const income = tx.type === 'income';
                    return (
                      <div
                        key={tx._id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          padding: '10px 0',
                          borderBottom:
                            idx === recentTx.length - 1
                              ? 'none'
                              : '1px solid var(--border-subtle)',
                        }}
                      >
                        <span
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: `color-mix(in srgb, ${color} 12%, transparent)`,
                            color,
                            flexShrink: 0,
                          }}
                        >
                          <Icon size={16} strokeWidth={1.75} />
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 500,
                              color: 'var(--text-primary)',
                              maxWidth: 140,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {tx.description || tx.category}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {shortDate(tx.date)}
                          </div>
                        </div>
                        <div
                          style={{
                            marginLeft: 'auto',
                            fontSize: 14,
                            fontWeight: 600,
                            fontVariantNumeric: 'tabular-nums',
                            whiteSpace: 'nowrap',
                            color: income ? 'var(--green)' : 'var(--red)',
                          }}
                        >
                          {income ? '+' : '-'}
                          {format(tx.amount)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionCard>
          </div>

          {/* SECTION 6 — Budget health + upcoming bills */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
              gap: 20,
              marginBottom: 20,
            }}
          >
            <SectionCard>
              <SectionHeader
                title="Budget Health"
                actionLabel="View all"
                onAction={() => navigate('/budgets')}
              />
              {extraLoading ? (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '16px 0' }}>
                  Loading…
                </div>
              ) : budgetRows.length === 0 ? (
                <EmptyBlock
                  icon={Wallet}
                  title="No budgets set"
                  actionLabel="Set a budget"
                  onAction={() => navigate('/budgets')}
                />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {budgetRows.map((b) => {
                    const limit = Number(b.limit) || 0;
                    const spent = Number(b.spent) || 0;
                    const pct = limit > 0 ? Math.round((spent / limit) * 100) : 0;
                    const tone =
                      pct >= 100 ? 'var(--red)' : pct >= 80 ? 'var(--amber)' : 'var(--accent)';
                    const pctColor =
                      pct >= 100 ? 'var(--red)' : pct >= 80 ? 'var(--amber)' : 'var(--text-muted)';
                    return (
                      <div key={b._id}>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 8,
                            marginBottom: 6,
                          }}
                        >
                          <span
                            style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}
                          >
                            {b.category}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 500, color: pctColor }}>
                            {pct}%
                          </span>
                        </div>
                        <div
                          style={{
                            height: 6,
                            borderRadius: 'var(--radius-full)',
                            background: 'var(--bg-elevated)',
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              height: '100%',
                              width: `${Math.min(pct, 100)}%`,
                              background: tone,
                              borderRadius: 'var(--radius-full)',
                              transition: 'width 600ms var(--ease)',
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionCard>

            <SectionCard>
              <SectionHeader
                title="Upcoming Bills"
                actionLabel="View all"
                onAction={() => navigate('/bills')}
              />
              {extraLoading ? (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '16px 0' }}>
                  Loading…
                </div>
              ) : upcomingBills.length === 0 ? (
                <EmptyBlock icon={CreditCard} title="No upcoming bills" />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {upcomingBills.map((bill) => {
                    const d = daysUntil(bill.nextDueDate);
                    let badge;
                    if (d < 0) badge = <Badge variant="danger">Overdue</Badge>;
                    else if (d === 0) badge = <Badge variant="warning">Today</Badge>;
                    else if (d <= 3)
                      badge = <Badge variant="warning">{`${d} day${d === 1 ? '' : 's'}`}</Badge>;
                    else badge = <Badge variant="default">{`${d} days`}</Badge>;
                    return (
                      <div
                        key={bill._id}
                        style={{ display: 'flex', alignItems: 'center', gap: 12 }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 500,
                              color: 'var(--text-primary)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              maxWidth: 160,
                            }}
                          >
                            {bill.name}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {shortDate(bill.nextDueDate)}
                          </div>
                        </div>
                        <div
                          style={{
                            marginLeft: 'auto',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              fontVariantNumeric: 'tabular-nums',
                              color: 'var(--text-primary)',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {format(bill.amount)}
                          </span>
                          {badge}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionCard>
          </div>

          {/* SECTION 7 — Mobile quick actions */}
          {isMobile && (
            <div
              className="dashboard-quick-actions"
              style={{
                display: 'flex',
                overflowX: 'auto',
                gap: 10,
                paddingBottom: 4,
                marginBottom: 20,
              }}
            >
              <QuickAction label="＋ Transaction" onClick={() => navigate('/transactions')} />
              <QuickAction label="🎯 Set Goal" onClick={() => navigate('/goals')} />
              <QuickAction label="💳 Pay Bill" onClick={() => navigate('/bills')} />
              <QuickAction label="✨ Ask AI" onClick={() => navigate('/chat')} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function QuickAction({ label, onClick }) {
  return (
    <div style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
      <Button variant="secondary" size="sm" onClick={onClick}>
        {label}
      </Button>
    </div>
  );
}

function BreakdownList({ heading, items, valueKey, currency, emptyText }) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 500,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--text-muted)',
          marginBottom: 8,
        }}
      >
        {heading}
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{emptyText}</div>
      ) : (
        <div>
          {items.map((item, idx) => (
            <div
              key={item._id || `${item.name}-${idx}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '8px 0',
                borderBottom:
                  idx === items.length - 1 ? 'none' : '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: 'var(--text-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.name}
                </div>
                {item.type && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.type}</div>
                )}
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  fontVariantNumeric: 'tabular-nums',
                  color: 'var(--text-primary)',
                  whiteSpace: 'nowrap',
                }}
              >
                {formatCurrency(item[valueKey], currency)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
