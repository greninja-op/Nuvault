/**
 * A labeled numeric input paired with a range slider. Moving the slider
 * updates the value and typing in the input updates the slider — both are
 * controlled by the same `value` / `onChange` pair. Pure presentational
 * helper used across all finance calculators to avoid repetition.
 *
 * Restyled onto the design system: the label row shows the field name on the
 * left and a live, formatted value on the right; the range track carries an
 * accent-coloured fill up to the thumb (computed inline) with a themed thumb
 * styled via the `.calc-slider` pseudo-elements in index.css.
 */
export default function SliderField({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  suffix,
  prefix,
  hint,
}) {
  const handle = (raw) => {
    if (raw === '') {
      onChange('');
      return;
    }
    const num = Number(raw);
    if (Number.isFinite(num)) onChange(num);
  };

  const numeric = Number(value) || 0;
  // Clamp into [min, max] for the fill computation only.
  const clamped = Math.min(Math.max(numeric, min), max);
  const pct = max > min ? ((clamped - min) / (max - min)) * 100 : 0;
  const fill = `linear-gradient(to right, var(--accent) 0%, var(--accent) ${pct}%, var(--bg-elevated) ${pct}%, var(--bg-elevated) 100%)`;

  const displayValue =
    value === '' || value === null || value === undefined
      ? '—'
      : `${prefix ?? ''}${Number(value).toLocaleString('en-IN')}${suffix ? ` ${suffix}` : ''}`;

  return (
    <div style={{ marginBottom: 20 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 12,
          marginBottom: 6,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {prefix && <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{prefix}</span>}
          <input
            type="number"
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={(e) => handle(e.target.value)}
            style={{
              width: 96,
              textAlign: 'right',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '6px 10px',
              fontFamily: 'Poppins, system-ui, sans-serif',
              fontSize: 13,
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
              color: 'var(--text-primary)',
              outline: 'none',
            }}
            aria-label={label}
          />
          {suffix && <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{suffix}</span>}
        </div>
      </div>

      {/* 9px side padding == half the 18px thumb, so it never clips at min/max. */}
      <div style={{ padding: '0 9px' }}>
        <input
          type="range"
          className="calc-slider"
          value={numeric}
          min={min}
          max={max}
          step={step}
          onChange={(e) => handle(e.target.value)}
          style={{ background: fill }}
        />
      </div>

      {hint && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>{hint}</p>
      )}
    </div>
  );
}
