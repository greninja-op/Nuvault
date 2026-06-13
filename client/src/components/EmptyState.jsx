/**
 * Empty-state panel shown when a collection loads successfully but is empty.
 * Renders a simple inline icon, a short message, and a call-to-action button
 * that typically opens the relevant "add" form.
 *
 * No external icon library is required — a small inline SVG keeps this
 * dependency-free.
 *
 * @param {object} props
 * @param {string} props.message      Short explanatory line.
 * @param {string} props.actionLabel  Button text (e.g. "Add transaction").
 * @param {() => void} props.onAction  Click handler for the button.
 * @param {React.ReactNode} [props.icon]  Optional custom icon node.
 */
export default function EmptyState({ message, actionLabel, onAction, icon }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <div className="text-slate-400" aria-hidden="true">
        {icon ?? <DefaultIcon />}
      </div>
      <p className="max-w-xs text-sm text-slate-500">{message}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-1 flex min-h-[44px] items-center justify-center rounded-md bg-indigo-600 px-5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function DefaultIcon() {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 14h8" />
    </svg>
  );
}
