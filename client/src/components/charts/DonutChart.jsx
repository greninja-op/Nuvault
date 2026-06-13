import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import useWindowSize from '../../hooks/useWindowSize';

/**
 * Donut chart with a center label and a legend below — used for budget,
 * portfolio, and spending-breakdown allocations.
 *
 * Props:
 *   data        [{ name, value, amount? }]
 *   centerValue large number shown in the donut hole (string or number)
 *   centerLabel small caption under the center value
 *   height      chart height (px)
 *   colors      slice color order (defaults to the app palette)
 *   valueFormatter  formats the legend/tooltip amount (defaults ₹ en-IN)
 */

export const DONUT_COLORS = [
  '#22c55e',
  '#7c6ee8',
  '#06b6d4',
  '#f59e0b',
  '#ef4444',
  '#a78bfa',
  '#34d399',
  '#818cf8',
];

function defaultFormat(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function PillTooltip({ active, payload, valueFormatter }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0];
  const amount = p.payload && p.payload.amount != null ? p.payload.amount : p.value;
  return (
    <div
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-full)',
        padding: '5px 12px',
        font: "500 12px/1 Poppins, system-ui, sans-serif",
        color: 'var(--text-primary)',
        boxShadow: 'var(--shadow-md)',
        whiteSpace: 'nowrap',
      }}
    >
      {p.name}: {valueFormatter(amount)}
    </div>
  );
}

export default function DonutChart({
  data = [],
  centerValue,
  centerLabel,
  height,
  colors = DONUT_COLORS,
  valueFormatter = defaultFormat,
}) {
  const { isMobile } = useWindowSize();
  const resolvedHeight = height ?? (isMobile ? 180 : 220);

  return (
    <div style={{ width: '100%' }}>
      <div style={{ position: 'relative', width: '100%', height: resolvedHeight, overflow: 'hidden' }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="58%"
              outerRadius="78%"
              paddingAngle={3}
              stroke="none"
            >
              {data.map((entry, i) => (
                <Cell key={entry.name ?? i} fill={colors[i % colors.length]} />
              ))}
            </Pie>
            <Tooltip content={<PillTooltip valueFormatter={valueFormatter} />} />
          </PieChart>
        </ResponsiveContainer>

        {(centerValue != null || centerLabel) && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            {centerValue != null && (
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                  fontVariantNumeric: 'tabular-nums',
                  lineHeight: 1.1,
                }}
              >
                {centerValue}
              </div>
            )}
            {centerLabel && (
              <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>
                {centerLabel}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Legend */}
      <div
        style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          flexWrap: 'wrap',
          gap: 8,
          justifyContent: isMobile ? 'flex-start' : 'center',
          alignItems: isMobile ? 'flex-start' : 'center',
          marginTop: 12,
        }}
      >
        {data.map((entry, i) => (
          <div key={entry.name ?? i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: colors[i % colors.length],
                display: 'inline-block',
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{entry.name}</span>
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
              {valueFormatter(entry.amount != null ? entry.amount : entry.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
