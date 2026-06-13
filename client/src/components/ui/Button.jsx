import { useState } from 'react';

/**
 * Pill button with variants and sizes.
 *
 * Props:
 *   variant   primary | secondary | ghost | danger | icon   (default primary)
 *   size      sm | md | lg                                   (default md)
 *   fullWidth boolean
 *   loading   boolean — shows a spinner and blocks pointer events
 *   disabled  boolean
 *   children, onClick, type, className, style, ...rest
 */
const SIZE_PADDING = {
  sm: '10px 18px',
  md: '12px 24px',
  lg: '14px 28px',
};

export default function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  disabled = false,
  children,
  onClick,
  type = 'button',
  className = '',
  style,
  ...rest
}) {
  const [hover, setHover] = useState(false);
  const [active, setActive] = useState(false);
  const isIcon = variant === 'icon';
  const isDisabled = disabled || loading;

  const base = {
    fontFamily: 'Poppins, system-ui, sans-serif',
    fontWeight: 500,
    fontSize: 14,
    borderRadius: isIcon ? 'var(--radius-md)' : 'var(--radius-full)',
    minHeight: isIcon ? 'unset' : 44,
    transition: 'all 180ms var(--ease)',
    display: isIcon ? 'flex' : fullWidth ? 'block' : 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: fullWidth ? '100%' : isIcon ? 36 : undefined,
    height: isIcon ? 36 : undefined,
    cursor: isDisabled ? 'not-allowed' : 'pointer',
    opacity: isDisabled ? 0.5 : 1,
    transform: active && !isDisabled ? 'scale(0.97)' : 'scale(1)',
    pointerEvents: loading ? 'none' : undefined,
    padding: isIcon ? 0 : SIZE_PADDING[size] ?? SIZE_PADDING.md,
  };

  const variantStyle = (() => {
    switch (variant) {
      case 'secondary':
        return {
          background: hover && !isDisabled ? 'var(--bg-hover)' : 'transparent',
          border: '1px solid var(--border)',
          color: 'var(--text-primary)',
        };
      case 'ghost':
        return {
          background: hover && !isDisabled ? 'var(--bg-hover)' : 'transparent',
          border: 'none',
          color: hover && !isDisabled ? 'var(--text-primary)' : 'var(--text-secondary)',
        };
      case 'danger':
        return {
          background: 'var(--red-muted)',
          color: 'var(--red)',
          border: `1px solid ${hover && !isDisabled ? 'var(--red)' : 'transparent'}`,
        };
      case 'icon':
        return {
          background: hover && !isDisabled ? 'var(--bg-hover)' : 'var(--bg-elevated)',
          border: 'none',
          color: 'var(--text-primary)',
        };
      case 'primary':
      default:
        return {
          background: hover && !isDisabled ? 'var(--accent-hover)' : 'var(--accent)',
          color: '#fff',
          border: 'none',
          boxShadow: hover && !isDisabled ? '0 0 0 3px var(--accent-glow)' : 'none',
        };
    }
  })();

  const spinnerColor = variant === 'primary' ? '#fff' : 'var(--accent)';

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      className={className}
      style={{ ...base, ...variantStyle, ...style }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setActive(false);
      }}
      onMouseDown={() => setActive(true)}
      onMouseUp={() => setActive(false)}
      {...rest}
    >
      {loading && (
        <span
          className="nuvault-spinner"
          style={{ color: spinnerColor, borderTopColor: 'transparent' }}
          aria-hidden="true"
        />
      )}
      {!isIcon || !loading ? children : null}
    </button>
  );
}
