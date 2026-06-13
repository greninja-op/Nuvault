import { useState } from 'react';

/**
 * Surface container. Three variants:
 *   - default      flat surface with a border
 *   - elevated     raised surface with a soft shadow
 *   - interactive  default + pointer cursor and a lift-on-hover affordance
 *
 * Props: variant, className, children, onClick, style, ...rest
 */
const BASE = {
  borderRadius: 'var(--radius-lg)',
  padding: 20,
};

export default function Card({
  variant = 'default',
  className = '',
  children,
  onClick,
  style,
  ...rest
}) {
  const [hover, setHover] = useState(false);

  const variantStyle = (() => {
    switch (variant) {
      case 'elevated':
        return {
          background: 'var(--bg-elevated)',
          boxShadow: 'var(--shadow-sm)',
        };
      case 'interactive':
        return {
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          cursor: 'pointer',
          transition: 'all 200ms var(--ease)',
          transform: hover ? 'translateY(-2px)' : 'translateY(0)',
          borderColor: hover ? 'var(--accent-glow)' : 'var(--border)',
          boxShadow: hover ? 'var(--shadow-md)' : 'none',
        };
      case 'default':
      default:
        return {
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
        };
    }
  })();

  const interactiveHandlers =
    variant === 'interactive'
      ? {
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
        }
      : {};

  return (
    <div
      className={className}
      onClick={onClick}
      style={{ ...BASE, ...variantStyle, ...style }}
      {...interactiveHandlers}
      {...rest}
    >
      {children}
    </div>
  );
}
