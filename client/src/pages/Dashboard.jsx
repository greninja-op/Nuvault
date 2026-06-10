import { useEffect, useState } from 'react';
import apiClient from '../api/client';
import { useDisplayCurrency } from '../currency/CurrencyContext';
import { extractError, formatCurrency } from '../lib/format';

/**
 * Dashboard / net-worth view. Fetches `GET /networth?currency=...` whenever
 * the selected display currency changes (R19.4) and renders the totals
 * plus a simple breakdown of assets and liabilities.
 */
export default function Dashboard() {
  const { displayCurrency } = useDisplayCurrency();
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

  const currency = data?.displayCurrency ?? displayCurrency;

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-600">
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
          <div className="grid gap-4 md:grid-cols-3">
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

          <div className="grid gap-6 md:grid-cols-2">
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

function SummaryCard({ label, value, tone = 'neutral' }) {
  const toneClass =
    tone === 'positive'
      ? 'text-emerald-600'
      : tone === 'negative'
        ? 'text-red-600'
        : 'text-slate-900';
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${toneClass}`}>{value}</div>
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
              className="flex items-center justify-between py-2 text-sm"
            >
              <div>
                <div className="font-medium text-slate-800">{item.name}</div>
                <div className="text-xs text-slate-500">{item.type}</div>
              </div>
              <div className="text-right">
                <div className="font-medium text-slate-900">
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
