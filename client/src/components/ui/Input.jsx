import { useState } from 'react';

/**
 * Labeled text input with optional error, hint, prefix, and suffix.
 * Any extra props are spread onto the underlying <input>.
 *
 * Props: label, error, hint, prefix, suffix, className, id, ...rest
 */
export default function Input({
  label,
  error,
  hint,
  prefix,
  suffix,
  className = '',
  id,
  style,
  ...rest
}) {
  const [focused, setFocused] = useState(false);
  const inputId = id || rest.name || undefined;

  const borderColor = error
    ? 'var(--red)'
    : focused
      ? 'var(--accent)'
      : 'var(--border)';
  const ring = error
    ? '0 0 0 3px var(--red-muted)'
    : focused
      ? '0 0 0 3px var(--accent-muted)'
      : 'none';

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {label && (
        <label
          htmlFor={inputId}
          style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}
        >
          {label}
        </label>
      )}

      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        {prefix != null && (
          <span
            style={{
              position: 'absolute',
              left: 14,
              color: 'var(--text-muted)',
              fontSize: 14,
              pointerEvents: 'none',
            }}
          >
            {prefix}
          </span>
        )}
        <input
          id={inputId}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          {...rest}
          style={{
            width: '100%',
            background: 'var(--bg-elevated)',
            border: `1px solid ${borderColor}`,
            borderRadius: 'var(--radius-md)',
            padding: '11px 14px',
            paddingLeft: prefix != null ? 30 : 14,
            paddingRight: suffix != null ? 30 : 14,
            fontFamily: 'Poppins, system-ui, sans-serif',
            fontSize: 14,
            color: 'var(--text-primary)',
            outline: 'none',
            boxShadow: ring,
            transition: 'border-color 180ms var(--ease), box-shadow 180ms var(--ease)',
            ...style,
          }}
        />
        {suffix != null && (
          <span
            style={{
              position: 'absolute',
              right: 14,
              color: 'var(--text-muted)',
              fontSize: 14,
              pointerEvents: 'none',
            }}
          >
            {suffix}
          </span>
        )}
      </div>

      {error && <span style={{ fontSize: 12, color: 'var(--red)', marginTop: 4 }}>{error}</span>}
      {!error && hint && (
        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{hint}</span>
      )}
    </div>
  );
}
