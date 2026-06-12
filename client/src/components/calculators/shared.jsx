import { useEffect, useState } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';
import { formatCurrency } from '../../lib/format';

/** Indigo / slate palette to match the rest of the app. */
export const CHART_COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#0ea5e9'];

/** Currency formatter defaulting to INR (₹). */
export function inr(amount) {
  return formatCurrency(amount, 'INR');
}

/**
 * `true` once the viewport is at least Tailwind's `md` breakpoint (768px).
 *
 * Calculator results render charts only in the desktop column; the mobile
 * column hides chart-bearing blocks via `has-[.chart]:hidden md:has-[.chart]:block`.
 * Mounting Recharts inside that hidden block makes ResponsiveContainer
 * measure 0×0 and triggers the "width(-1) and height(-1)" warning. Gating
 * on this hook skips the mount until the parent actually has a size.
 */
function useIsDesktop() {
  const getMatch = () =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(min-width: 768px)').matches;

  const [isDesktop, setIsDesktop] = useState(getMatch);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const mql = window.matchMedia('(min-width: 768px)');
    const handler = (e) => setIsDesktop(e.matches);
    setIsDesktop(mql.matches);
    if (mql.addEventListener) mql.addEventListener('change', handler);
    else mql.addListener(handler);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', handler);
      else mql.removeListener(handler);
    };
  }, []);

  return isDesktop;
}

/** Two-column responsive shell: controls on the left, results on the right. */
export function CalculatorLayout({ controls, results }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        {controls}
      </div>
      <div className="space-y-5">{results}</div>
    </div>
  );
}

/** A single labeled result row. */
export function ResultRow({ label, value, tone = 'neutral' }) {
  const toneClass =
    tone === 'positive'
      ? 'text-emerald-600'
      : tone === 'negative'
        ? 'text-red-600'
        : tone === 'accent'
          ? 'text-indigo-600'
          : 'text-slate-900';
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-2 last:border-0">
      <span className="text-sm text-slate-600">{label}</span>
      <span className={`text-sm font-semibold ${toneClass}`}>{value}</span>
    </div>
  );
}

/** Card wrapper for the results breakdown.
 *
 * When the card contains a chart (a child marked with the `chart` class via
 * {@link SplitPie}/{@link SplitBar}), the whole card is hidden on small
 * screens and shown from `md` up — per the mobile spec, charts appear only
 * on tablet and above. Cards without a chart are unaffected. */
export function ResultCard({ title, children }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm has-[.chart]:hidden md:has-[.chart]:block">
      {title && <h3 className="mb-2 text-sm font-semibold text-slate-900">{title}</h3>}
      {children}
    </div>
  );
}

/** A donut/pie chart visualising the split between two or more segments. */
export function SplitPie({ data }) {
  const isDesktop = useIsDesktop();
  const safe = data.filter((d) => Number(d.value) > 0);
  if (safe.length === 0) {
    return (
      <p className="chart py-8 text-center text-sm text-slate-500">
        Enter values to see the breakdown.
      </p>
    );
  }
  // The wrapping `.chart` block stays in the DOM (so the responsive
  // visibility selector still matches) but we skip mounting the chart
  // itself when the container is hidden — otherwise ResponsiveContainer
  // measures 0×0 and Recharts logs a width(-1)/height(-1) warning.
  return (
    <div className="chart h-64 w-full">
      {isDesktop ? (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={safe}
              dataKey="value"
              nameKey="name"
              innerRadius={55}
              outerRadius={85}
              paddingAngle={2}
            >
              {safe.map((entry, i) => (
                <Cell key={entry.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(v) => inr(v)} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      ) : null}
    </div>
  );
}

/** A bar chart, used where comparisons read more naturally than a pie. */
export function SplitBar({ data, bars }) {
  const isDesktop = useIsDesktop();
  return (
    <div className="chart h-64 w-full">
      {isDesktop ? (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} />
            <YAxis
              tick={{ fontSize: 11, fill: '#64748b' }}
              tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)}
            />
            <Tooltip formatter={(v) => inr(v)} />
            <Legend />
            {bars.map((b, i) => (
              <Bar
                key={b.dataKey}
                dataKey={b.dataKey}
                name={b.name}
                fill={CHART_COLORS[i % CHART_COLORS.length]}
                radius={[4, 4, 0, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      ) : null}
    </div>
  );
}
