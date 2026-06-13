import {
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

/**
 * Renders the `charts` array attached to an AI chart_response inside a chat
 * bubble. Supports two chart types:
 *   - pie:  suggested/current allocation (percentage slices + ₹ legend)
 *   - line: multi-year projection (year on X, ₹ on Y)
 *
 * Each chart is full-width of the bubble, responsive, transparent background,
 * and borderless.
 */

const COLORS = ['#6366f1', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444'];

/** Compact ₹ formatter for axes/legends, e.g. 1240000 → "₹12,40,000". */
function rupee(n) {
  const num = Number(n || 0);
  return `₹${num.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function PieChartBlock({ title, data }) {
  return (
    <div className="mt-3">
      {title && <div className="mb-1 text-xs font-medium text-slate-500">{title}</div>}
      <div style={{ width: '100%', height: 250 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={80}
              label={(entry) => `${entry.value}%`}
            >
              {data.map((entry, i) => (
                <Cell key={entry.name} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, name, props) => {
                const amt = props && props.payload && props.payload.amount;
                return [amt != null ? `${value}% (${rupee(amt)})` : `${value}%`, name];
              }}
            />
            <Legend
              formatter={(value, entry) => {
                const amt = entry && entry.payload && entry.payload.amount;
                return amt != null ? `${value} — ${rupee(amt)}` : value;
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function LineChartBlock({ title, data }) {
  return (
    <div className="mt-3">
      {title && <div className="mb-1 text-xs font-medium text-slate-500">{title}</div>}
      <div style={{ width: '100%', height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="year" tick={{ fontSize: 11, fill: '#64748b' }} />
            <YAxis
              tick={{ fontSize: 11, fill: '#64748b' }}
              width={70}
              tickFormatter={(v) => rupee(v)}
            />
            <Tooltip formatter={(value) => rupee(value)} />
            <Line
              type="monotone"
              dataKey="amount"
              stroke="#6366f1"
              strokeWidth={2}
              dot={{ r: 4, fill: '#6366f1' }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function ChatCharts({ charts }) {
  if (!Array.isArray(charts) || charts.length === 0) return null;
  return (
    <div className="w-full">
      {charts.map((chart, i) => {
        if (!chart || !Array.isArray(chart.data) || chart.data.length === 0) return null;
        if (chart.chartType === 'pie') {
          return <PieChartBlock key={i} title={chart.title} data={chart.data} />;
        }
        if (chart.chartType === 'line') {
          return <LineChartBlock key={i} title={chart.title} data={chart.data} />;
        }
        return null;
      })}
    </div>
  );
}
