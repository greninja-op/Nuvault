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

/** Two-column responsive shell: controls on the left, results on the right.
 *
 * The whole calculator (inputs + results) sits inside one surface Card. On
 * desktop the columns split ~55/45 (controls / results); on mobile they stack
 * with inputs first, then the result blocks.
 *
 * `bottomChart` (optional): a chart card that renders BELOW the controls in
 * the left column on desktop — used to balance column heights when the right
 * column carries more than one chart. On mobile it flows after the results so
 * the reading order (sliders → summary → chart) is preserved. When a
 * calculator has no bottom chart, nothing is rendered in that slot. */
export function CalculatorLayout({ controls, results, bottomChart }) {
  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        padding: 24,
      }}
    >
      <div className="calc-grid">
        <div className="calc-controls">{controls}</div>
        <div className="calc-results" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {results}
        </div>
        {bottomChart ? <div className="calc-bottom">{bottomChart}</div> : null}
      </div>
    </div>
  );
}

/** A single labeled result row. */
export function ResultRow({ label, value, tone = 'neutral' }) {
  const color =
    tone === 'positive'
      ? 'var(--green)'
      : tone === 'negative'
        ? 'var(--red)'
        : tone === 'accent'
          ? 'var(--accent)'
          : 'var(--text-primary)';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '9px 0',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color }}>
        {value}
      </span>
    </div>
  );
}

/** Card wrapper for the results breakdown.
 *
 * When the card contains a chart (a child marked with the `chart` class via
 * {@link SplitPie}/{@link SplitBar}), the whole card is hidden on small
 * screens and shown from `md` up — per the mobile spec, charts appear only
 * on tablet and above. Cards without a chart are unaffected.
 *
 * The Tailwind `has-[.chart]:hidden md:has-[.chart]:block` classes drive that
 * responsive gating; the visual surface is the design-system elevated card. */
export function ResultCard({ title, children }) {
  return (
    <div
      className="has-[.chart]:hidden md:has-[.chart]:block"
      style={{
        background: 'var(--bg-elevated)',
        borderRadius: 'var(--radius-lg)',
        padding: 20,
      }}
    >
      {title && (
        <h3
          style={{
            fontSize: 12,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--text-muted)',
            marginBottom: 10,
          }}
        >
          {title}
        </h3>
      )}
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
