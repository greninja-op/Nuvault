import { useId } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import useWindowSize from '../../hooks/useWindowSize';

/**
 * Reusable smooth area chart used across the app.
 *
 * Style: monotone curve, gradient area fill (color → transparent), a soft
 * glow on the line, a glowing active-dot ring on hover, barely-there grid,
 * and a lightweight floating-pill tooltip. Colors come from CSS design tokens
 * so the chart re-themes automatically.
 *
 * Props:
 *   data, dataKey, xKey, title, subtitle, height
 *   color        line/gradient color (default green #22c55e)
 *   showGradient (default true)
 *   card         wrap in a surface card (default true) — set false inside bubbles
 *   sparkline    decorative mini-chart: no axes/grid/tooltip, no pointer events
 */

/** ₹ formatter with K / L / Cr suffixes. */
export function formatRupeeShort(v) {
  const n = Number(v || 0);
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n}`;
}

/** Small floating-pill tooltip showing just the value. */
function CustomTooltip({ active, payload }) {
  if (!active || !payload || payload.length === 0) return null;
  const value = payload[0].value;
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
      {formatRupeeShort(value)}
    </div>
  );
}

/** Active point: glowing outer ring + solid inner dot. */
function CustomActiveDot({ cx, cy, color = '#22c55e' }) {
  if (cx == null || cy == null) return null;
  return (
    <g style={{ filter: `drop-shadow(0 0 6px ${color})` }}>
      <circle cx={cx} cy={cy} r={8} fill="none" stroke={color} strokeOpacity={0.35} strokeWidth={1} />
      <circle cx={cx} cy={cy} r={4} fill={color} />
    </g>
  );
}

export default function AreaChartCard({
  data = [],
  dataKey,
  xKey,
  title,
  subtitle,
  height,
  color = '#22c55e',
  showGradient = true,
  card = true,
  sparkline = false,
}) {
  const { isMobile } = useWindowSize();
  const gradId = `areaGrad-${useId().replace(/[:]/g, '')}`;
  const resolvedHeight = height ?? (sparkline ? 60 : isMobile ? 200 : 280);

  const chart = (
    <div
      style={{
        width: '100%',
        height: resolvedHeight,
        filter: sparkline ? undefined : `drop-shadow(0 0 8px ${hexToGlow(color)})`,
        pointerEvents: sparkline ? 'none' : undefined,
        overflow: 'hidden',
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
          {showGradient && (
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                <stop offset="75%" stopColor={color} stopOpacity={0.04} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
          )}

          {!sparkline && (
            <CartesianGrid strokeDasharray="3 6" stroke="var(--chart-grid)" vertical={false} />
          )}

          {!sparkline && (
            <XAxis
              dataKey={xKey}
              tick={{ fontSize: 11, fill: 'var(--text-muted)', fontFamily: 'Poppins' }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              padding={{ left: 8, right: 8 }}
            />
          )}

          {!sparkline && (
            <YAxis
              tick={{ fontSize: 11, fill: 'var(--text-muted)', fontFamily: 'Poppins' }}
              tickLine={false}
              axisLine={false}
              width={isMobile ? 48 : 60}
              tickFormatter={formatRupeeShort}
            />
          )}

          {!sparkline && <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'var(--chart-grid)' }} />}

          <Area
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={sparkline ? 1.5 : 2}
            fill={showGradient ? `url(#${gradId})` : 'none'}
            dot={false}
            activeDot={sparkline ? false : <CustomActiveDot color={color} />}
            isAnimationActive
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );

  if (!card) return chart;

  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border)',
        padding: isMobile ? 12 : 16,
        overflow: 'hidden',
      }}
    >
      {(title || subtitle) && (
        <div style={{ marginBottom: 8 }}>
          {title && (
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</div>
          )}
          {subtitle && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{subtitle}</div>
          )}
        </div>
      )}
      {chart}
    </div>
  );
}

/** Convert a hex color to a low-alpha rgba string for the line glow. */
function hexToGlow(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 'rgba(34,197,94,0.3)';
  const int = parseInt(m[1], 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r},${g},${b},0.3)`;
}
