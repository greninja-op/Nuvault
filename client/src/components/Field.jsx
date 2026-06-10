/**
 * Labeled form field with optional inline error message.
 *
 * Renders a label, an arbitrary input element (passed via `children`),
 * and a small error block underneath. Keep the markup simple so each
 * page can compose form rows without a heavy form library.
 */
export default function Field({ label, htmlFor, error, hint, children }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700">
      <span>{label}</span>
      <div className="mt-1">{children}</div>
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </label>
  );
}

/** Shared input class so every form has the same look. */
export const inputClass =
  'block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';
