import { inputClass } from '../Field';

/**
 * A labeled numeric input paired with a range slider. Moving the slider
 * updates the value and typing in the input updates the slider — both are
 * controlled by the same `value` / `onChange` pair. Pure presentational
 * helper used across all finance calculators to avoid repetition.
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

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <div className="flex items-center gap-1">
          {prefix && <span className="text-sm text-slate-500">{prefix}</span>}
          <input
            type="number"
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={(e) => handle(e.target.value)}
            className={`${inputClass} w-32 text-right`}
          />
          {suffix && <span className="text-sm text-slate-500">{suffix}</span>}
        </div>
      </div>
      <input
        type="range"
        value={Number(value) || 0}
        min={min}
        max={max}
        step={step}
        onChange={(e) => handle(e.target.value)}
        className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-200 accent-indigo-600"
      />
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
