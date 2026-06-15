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

/** ₹ formatter with K / L / Cr suffixes; handles negative values. */
export function formatRupeeShort(v) {
  const n = Number(v || 0);
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(1)}Cr`;
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(1)}L`;
  if (abs >= 1000) return `${sign}₹${(abs / 1000).toFixed(1)}K`;
  return `${sign}₹${abs}`;
}

/** Small floating-pill tooltip showing just the value. */
function CustomTooltip({ active, payload }) {
  if (!active || !payload || payload.length === 0) return null;
  const value = payload[0].value;
  return (
    <div
      style={{
        background: 'var(--bg-surface)',
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
function CustomActiveDot({ cx, cy, color = '#16a34a' }) {
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
  color = '#16a34a',
  showGradient = true,
  card = true,
  sparkline = false,
}) {
  const { isMobile } = useWindowSize();
  const gradId = `areaGrad-${useId().replace(/[:]/g, '')}`;
  const resolvedHeight = height ?? (sparkline ? 60 : isMobile ? 200 : 280);

  // Detect an all-negative series (e.g. a net-debt net-worth history).
  const numericValues = data
    .map((d) => Number(d?.[dataKey]))
    .filter((n) => Number.isFinite(n));
  const allNegative =
    !sparkline && numericValues.length > 0 && numericValues.every((n) => n < 0);

  // A negative (net-debt) series must NOT read as green "growth". Use a
  // warning amber tone, fill downward toward the baseline, and pin the Y
  // scale to nice rounded bounds with explicit ticks so the line never
  // floats outside the bottom grid line.
  const effectiveColor = allNegative ? '#d97706' : color;

  let yDomain = ['auto', 'auto'];
  let yTicks;
  let areaBaseValue;
  if (allNegative) {
    const dataMin = Math.min(...numericValues);
    const dataMax = Math.max(...numericValues);
    const step = niceNum((dataMax - dataMin) / 3 || Math.abs(dataMin) / 3 || 1, true);
    const lower = Math.floor((dataMin - step * 0.5) / step) * step;
    const upper = Math.ceil((dataMax + step * 0.5) / step) * step;
    yDomain = [lower, upper];
    yTicks = [];
    for (let t = lower; t <= upper + step * 0.001; t += step) yTicks.push(Math.round(t));
    areaBaseValue = lower; // fill downward to the bottom of the plot
  }

  // Uniform X tick spacing: choose an interval that yields ~6 evenly spaced
  // labels so they never crowd or duplicate at the right edge.
  const xInterval = !sparkline && data.length > 8 ? Math.ceil(data.length / 6) - 1 : 0;

  const chart = (
    <div
      style={{
        width: '100%',
        height: resolvedHeight,
        filter: sparkline ? undefined : `drop-shadow(0 0 6px ${hexToGlow(effectiveColor)})`,
        pointerEvents: sparkline ? 'none' : undefined,
        overflow: 'hidden',
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
          {showGradient && (
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={effectiveColor} stopOpacity={0.2} />
                <stop offset="75%" stopColor={effectiveColor} stopOpacity={0.05} />
                <stop offset="100%" stopColor={effectiveColor} stopOpacity={0} />
              </linearGradient>
            </defs>
          )}

          {!sparkline && (
            <CartesianGrid strokeDasharray="3 6" stroke="var(--border)" vertical={false} />
          )}

          {!sparkline && (
            <XAxis
              dataKey={xKey}
              tick={{ fontSize: 11, fill: 'var(--text-muted)', fontFamily: 'Poppins' }}
              tickLine={false}
              axisLine={false}
              interval={xInterval}
              minTickGap={16}
              tickMargin={8}
              padding={{ left: 8, right: 8 }}
            />
          )}

          {!sparkline && (
            <YAxis
              tick={{ fontSize: 11, fill: 'var(--text-muted)', fontFamily: 'Poppins' }}
              tickLine={false}
              axisLine={false}
              width={isMobile ? 48 : 60}
              domain={yDomain}
              ticks={yTicks}
              tickFormatter={formatRupeeShort}
            />
          )}

          {!sparkline && <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'var(--chart-grid)' }} />}

          <Area
            type="monotone"
            dataKey={dataKey}
            stroke={effectiveColor}
            strokeWidth={sparkline ? 1.5 : 2}
            fill={showGradient ? `url(#${gradId})` : 'none'}
            baseValue={areaBaseValue}
            dot={false}
            activeDot={sparkline ? false : <CustomActiveDot color={effectiveColor} />}
            isAnimationActive
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );

  const chartWithNote = (
    <>
      {chart}
      {allNegative && !card && (
        <div
          style={{
            fontSize: 12,
            color: 'var(--text-muted)',
            textAlign: 'center',
            marginTop: 8,
          }}
        >
          Values shown are negative (net debt position)
        </div>
      )}
    </>
  );

  if (!card) return chartWithNote;

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
      {(title || subtitle || allNegative) && (
        <div style={{ marginBottom: 8 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            {title && (
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                {title}
              </div>
            )}
            {allNegative && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '3px 10px',
                  borderRadius: 'var(--radius-full)',
                  background: 'var(--amber-muted)',
                  color: 'var(--amber)',
                  fontSize: 12,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                ▼ Net debt position
              </span>
            )}
          </div>
          {subtitle && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>
          )}
        </div>
      )}
      {chartWithNote}
    </div>
  );
}

/**
 * Round a number to a "nice" 1 / 2 / 5 × 10ⁿ value, for tidy axis steps.
 * When `round` is false it rounds the magnitude up to the next nice number.
 */
function niceNum(range, round) {
  const safe = Math.abs(range) || 1;
  const exp = Math.floor(Math.log10(safe));
  const frac = safe / 10 ** exp;
  let niceFrac;
  if (round) {
    if (frac < 1.5) niceFrac = 1;
    else if (frac < 3) niceFrac = 2;
    else if (frac < 7) niceFrac = 5;
    else niceFrac = 10;
  } else if (frac <= 1) niceFrac = 1;
  else if (frac <= 2) niceFrac = 2;
  else if (frac <= 5) niceFrac = 5;
  else niceFrac = 10;
  return niceFrac * 10 ** exp;
}

/** Convert a hex color to a low-alpha rgba string for the line glow. */
function hexToGlow(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 'rgba(22,163,74,0.4)';
  const int = parseInt(m[1], 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r},${g},${b},0.4)`;
}
