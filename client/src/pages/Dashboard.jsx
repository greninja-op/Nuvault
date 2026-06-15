import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import apiClient from '../api/client';
import { useDisplayCurrency } from '../currency/CurrencyContext';
import { extractError, formatCurrency } from '../lib/format';
import DashboardSkeleton from '../components/skeletons/DashboardSkeleton';
import { SkeletonCard } from '../components/SkeletonLoader';
import AreaChartCard, { formatRupeeShort } from '../components/charts/AreaChartCard';
import useSnapshots from '../hooks/useSnapshots';
import useWindowSize from '../hooks/useWindowSize';

/**
 * Dashboard / net-worth view. Fetches `GET /networth?currency=...` whenever
 * the selected display currency changes (R19.4) and renders the totals
 * plus a simple breakdown of assets and liabilities.
 */
export default function Dashboard() {
  const { displayCurrency } = useDisplayCurrency();
  const { isMobile } = useWindowSize();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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

  // Declared after the net-worth effect so the page's own request is issued
  // first; snapshots are decorative and degrade gracefully when unavailable.
  const { snapshots, loading: snapshotsLoading } = useSnapshots();

  const currency = data?.displayCurrency ?? displayCurrency;

  if (loading) return <DashboardSkeleton />;

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold sm:text-2xl" style={{ color: 'var(--text-primary)' }}>
          Dashboard
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Snapshot of your assets, liabilities, and net worth.
        </p>
      </header>

      {loading && <p className="text-sm text-slate-500">Loading…</p>}

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {!loading && !error && data && (
        <>
          {/* Summary cards: stacked on mobile, 3-across on tablet+ */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <SummaryCard
              label="Net worth"
              value={formatCurrency(data.netWorth, currency)}
              tone={data.netWorth >= 0 ? 'positive' : 'negative'}
            />
            <SummaryCard
              label="Total assets"
              value={formatCurrency(data.totalAssets, currency)}
            />
            <SummaryCard
              label="Total liabilities"
              value={formatCurrency(data.totalLiabilities, currency)}
            />
          </div>

          {/* Net-worth trend (last 30 days) — only with enough history */}
          {snapshotsLoading ? (
            <SkeletonCard height="200px" />
          ) : snapshots.length >= 2 ? (
            <AreaChartCard
              title="Net Worth — Last 30 Days"
              data={snapshots}
              dataKey="netWorth"
              xKey="label"
              height={isMobile ? 200 : 260}
            />
          ) : null}

          {/* Assets vs liabilities vs net worth — current standing */}
          <NetWorthBar data={data} isMobile={isMobile} />

          {/* Breakdown panels: full width on mobile, 2-up on tablet+ */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <BreakdownList
              title="Assets"
              items={data.assets || []}
              valueKey="value"
              currency={currency}
              emptyText="No assets yet."
            />
            <BreakdownList
              title="Liabilities"
              items={data.liabilities || []}
              valueKey="amount"
              currency={currency}
              emptyText="No liabilities yet."
            />
          </div>
        </>
      )}
    </section>
  );
}

function NetWorthBar({ data, isMobile }) {
  if (!data) return null;
  const netWorth = Number(data.netWorth) || 0;
  const chartData = [
    { name: 'Assets', value: Number(data.totalAssets) || 0, fill: '#22c55e' },
    { name: 'Liabilities', value: Number(data.totalLiabilities) || 0, fill: '#ef4444' },
    {
      name: 'Net Worth',
      value: Math.abs(netWorth),
      fill: netWorth >= 0 ? '#7c6ee8' : '#ef4444',
    },
  ];
  const hasData = chartData.some((d) => d.value > 0);
  if (!hasData) return null;

  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-sm)',
        padding: isMobile ? 12 : 16,
        overflow: 'hidden',
      }}
    >
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
          Assets vs Liabilities
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Current standing</div>
      </div>
      <div style={{ width: '100%', height: isMobile ? 200 : 260, overflow: 'hidden' }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 6" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11, fill: 'var(--text-muted)', fontFamily: 'Poppins' }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: 'var(--text-muted)', fontFamily: 'Poppins' }}
              tickLine={false}
              axisLine={false}
              width={isMobile ? 48 : 60}
              tickFormatter={formatRupeeShort}
            />
            <Tooltip content={<BarPillTooltip />} cursor={{ fill: 'var(--chart-grid)' }} />
            <Bar
              dataKey="value"
              radius={[6, 6, 0, 0]}
              maxBarSize={isMobile ? 28 : 40}
            >
              {chartData.map((entry) => (
                <Cell key={entry.name} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function BarPillTooltip({ active, payload }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-full)',
        padding: '5px 12px',
        font: '500 12px/1 Poppins, system-ui, sans-serif',
        color: 'var(--text-primary)',
        boxShadow: 'var(--shadow-md)',
        whiteSpace: 'nowrap',
      }}
    >
      {payload[0].payload.name}: {formatRupeeShort(payload[0].value)}
    </div>
  );
}

function SummaryCard({ label, value, tone = 'neutral' }) {
  const valueColor =
    tone === 'positive'
      ? 'var(--green)'
      : tone === 'negative'
        ? 'var(--red)'
        : 'var(--text-primary)';
  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        padding: '20px',
      }}
    >
      <div
        style={{
          color: 'var(--text-muted)',
          fontSize: '11px',
          fontWeight: 500,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        {label}
      </div>
      <div
        className="mt-2 break-words text-xl font-semibold leading-tight sm:text-2xl"
        style={{ color: valueColor, fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </div>
    </div>
  );
}

function BreakdownList({ title, items, valueKey, currency, emptyText }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">{emptyText}</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {items.map((item) => (
            <li
              key={item._id || `${item.name}-${item[valueKey]}`}
              className="flex items-center justify-between gap-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-slate-800">{item.name}</div>
                <div className="text-xs text-slate-500">{item.type}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-medium text-slate-900 tabular-nums whitespace-nowrap">
                  {formatCurrency(item[valueKey], currency)}
                </div>
                {item.conversionUnavailable && (
                  <div className="text-xs text-amber-600">
                    Conversion unavailable
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
