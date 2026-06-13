/**
 * Lightweight CSS-only shimmer skeleton primitives.
 *
 * These render instantly (no browser-capture / build step) and are used to
 * compose per-page skeleton layouts in `components/skeletons/`. The shimmer
 * animation + colors live in `index.css` (`.skeleton-base`, driven by the
 * `--bg-elevated` / `--bg-hover` design tokens for theme support).
 *
 * Variants:
 *   - SkeletonCard   — a rounded shimmer block (cards, buttons, charts)
 *   - SkeletonText   — a thin shimmer line (text, labels)
 *   - SkeletonCircle — a round shimmer (avatars, icons)
 */

/**
 * A rounded shimmer block.
 *
 * @param {object} props
 * @param {string|number} [props.width='100%']
 * @param {string|number} [props.height='80px']
 * @param {string} [props.className='']
 */
export function SkeletonCard({ width = '100%', height = '80px', className = '' }) {
  return (
    <div
      className={`skeleton-base ${className}`}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}

/**
 * A thin shimmer line for text.
 *
 * @param {object} props
 * @param {string|number} [props.width='100%']
 * @param {string} [props.className='']
 */
export function SkeletonText({ width = '100%', className = '' }) {
  return (
    <div
      className={`skeleton-base ${className}`}
      style={{ width, height: '0.75rem', borderRadius: '4px' }}
      aria-hidden="true"
    />
  );
}

/**
 * A round shimmer for avatars / icons.
 *
 * @param {object} props
 * @param {string|number} [props.size=40]  pixel size (number) or any CSS length
 */
export function SkeletonCircle({ size = 40 }) {
  const dimension = typeof size === 'number' ? `${size}px` : size;
  return (
    <div
      className="skeleton-base"
      style={{ width: dimension, height: dimension, borderRadius: '50%' }}
      aria-hidden="true"
    />
  );
}

/**
 * Shared wrapper that labels a skeleton region for assistive tech and gives
 * a consistent vertical rhythm. Optional — page skeletons can use it or not.
 */
export function SkeletonScreen({ children, className = '' }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className={className}>
      <span className="sr-only">Loading…</span>
      {children}
    </div>
  );
}

export default SkeletonCard;
