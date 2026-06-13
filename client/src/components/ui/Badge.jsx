/**
 * Small pill label. Variants: success, danger, warning, accent, default.
 *
 * Props: variant, children, className, style, ...rest
 */
const VARIANTS = {
  success: { background: 'var(--green-muted)', color: 'var(--green)' },
  danger: { background: 'var(--red-muted)', color: 'var(--red)' },
  warning: { background: 'var(--amber-muted)', color: 'var(--amber)' },
  accent: { background: 'var(--accent-muted)', color: 'var(--accent)' },
  default: { background: 'var(--bg-elevated)', color: 'var(--text-secondary)' },
};

export default function Badge({ variant = 'default', children, className = '', style, ...rest }) {
  const tone = VARIANTS[variant] ?? VARIANTS.default;
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        borderRadius: 'var(--radius-full)',
        padding: '3px 10px',
        font: '500 12px/1 Poppins, system-ui, sans-serif',
        whiteSpace: 'nowrap',
        ...tone,
        ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  );
}
