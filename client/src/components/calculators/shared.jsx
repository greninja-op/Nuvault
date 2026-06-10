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

/** Card wrapper for the results breakdown. */
export function ResultCard({ title, children }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      {title && <h3 className="mb-2 text-sm font-semibold text-slate-900">{title}</h3>}
      {children}
    </div>
  );
}

/** A donut/pie chart visualising the split between two or more segments. */
export function SplitPie({ data }) {
  const safe = data.filter((d) => Number(d.value) > 0);
  if (safe.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-slate-500">
        Enter values to see the breakdown.
      </p>
    );
  }
  return (
    <div className="h-64 w-full">
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
    </div>
  );
}

/** A bar chart, used where comparisons read more naturally than a pie. */
export function SplitBar({ data, bars }) {
  return (
    <div className="h-64 w-full">
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
    </div>
  );
}
