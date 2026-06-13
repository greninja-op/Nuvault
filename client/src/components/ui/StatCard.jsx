import { TrendingDown, TrendingUp } from 'lucide-react';
import Card from './Card';

/**
 * Headline metric card: label + icon, a large value, and an optional trend.
 *
 * Props:
 *   label, value
 *   trend       string like "+12.4%" or "-3.1%" (sign drives the color)
 *   trendLabel  caption next to the trend (e.g. "vs last month")
 *   icon        a lucide icon component (e.g. Wallet)
 *   iconColor   CSS color for the icon + its tinted circle (default accent)
 *   valueColor  CSS color for the value (default text-primary)
 */
export default function StatCard({
  label,
  value,
  trend,
  trendLabel,
  icon: IconCmp,
  iconColor = 'var(--accent)',
  valueColor = 'var(--text-primary)',
}) {
  const trendStr = trend == null ? '' : String(trend);
  const isPositive = trendStr.startsWith('+');
  const isNegative = trendStr.startsWith('-');
  const trendColor = isPositive
    ? 'var(--green)'
    : isNegative
      ? 'var(--red)'
      : 'var(--text-muted)';
  const TrendIcon = isNegative ? TrendingDown : TrendingUp;

  return (
    <Card variant="default">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <span className="text-label">{label}</span>
        {IconCmp && (
          <span
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: tint(iconColor),
              color: iconColor,
              flexShrink: 0,
            }}
          >
            <IconCmp size={18} strokeWidth={1.75} />
          </span>
        )}
      </div>

      <div
        style={{
          marginTop: 12,
          fontSize: 24,
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          color: valueColor,
          lineHeight: 1.2,
        }}
      >
        {value}
      </div>

      {(trendStr || trendLabel) && (
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          {trendStr && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 12,
                fontWeight: 500,
                color: trendColor,
              }}
            >
              <TrendIcon size={14} strokeWidth={2} />
              {trendStr}
            </span>
          )}
          {trendLabel && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{trendLabel}</span>
          )}
        </div>
      )}
    </Card>
  );
}

/**
 * Produce a ~15% opacity tint of the icon color for the circle background.
 * For CSS variables we can't compute alpha, so map the known accent var to
 * its muted token and fall back to color-mix for everything else.
 */
function tint(color) {
  if (color === 'var(--accent)') return 'var(--accent-muted)';
  if (color === 'var(--green)') return 'var(--green-muted)';
  if (color === 'var(--red)') return 'var(--red-muted)';
  if (color === 'var(--amber)') return 'var(--amber-muted)';
  return `color-mix(in srgb, ${color} 15%, transparent)`;
}
