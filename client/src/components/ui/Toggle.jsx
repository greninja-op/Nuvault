/**
 * Accessible on/off switch. The track + thumb are purely visual; an
 * invisible checkbox input carries the real state for assistive tech.
 *
 * Props: checked, onChange, label, id
 */
export default function Toggle({ checked = false, onChange, label, id }) {
  const inputId = id || (label ? `toggle-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);

  return (
    <label
      htmlFor={inputId}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        cursor: 'pointer',
      }}
    >
      <span
        style={{
          position: 'relative',
          display: 'inline-block',
          width: 44,
          height: 24,
          borderRadius: 'var(--radius-full)',
          background: checked ? 'var(--accent)' : 'var(--border)',
          transition: 'background 200ms var(--ease)',
          flexShrink: 0,
        }}
      >
        <input
          id={inputId}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange?.(e.target.checked)}
          style={{
            position: 'absolute',
            opacity: 0,
            width: '100%',
            height: '100%',
            margin: 0,
            cursor: 'pointer',
          }}
        />
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 2,
            left: checked ? 22 : 2,
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: '#fff',
            boxShadow: 'var(--shadow-sm)',
            transition: 'left 220ms var(--ease-spring)',
          }}
        />
      </span>
      {label && (
        <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>{label}</span>
      )}
    </label>
  );
}
