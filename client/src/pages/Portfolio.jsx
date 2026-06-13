import { useEffect, useMemo, useState } from 'react';
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import apiClient from '../api/client';
import Field, { inputClass } from '../components/Field';
import Modal from '../components/Modal';
import { useDisplayCurrency } from '../currency/CurrencyContext';
import { extractError, formatCurrency } from '../lib/format';
import { sanitizeInput } from '../utils/sanitize';
import PortfolioSkeleton from '../components/skeletons/PortfolioSkeleton';
import EmptyState from '../components/EmptyState';

/**
 * Portfolio overview. A single unified `/portfolio` resource backs every
 * asset kind via a `kind` discriminator; the backend computes invested /
 * current value / returns and a per-kind allocation on every request.
 *
 * Endpoints:
 *   GET    /portfolio/summary  — items (with computed values) + totals +
 *                                allocation
 *   POST   /portfolio          — create (body carries `kind`)
 *   PUT    /portfolio/:id       — update
 *   DELETE /portfolio/:id       — delete
 */

/**
 * Per-kind UI configuration: the section heading, the singular label used on
 * the "Add" button and modal title, and the ordered field set the form
 * renders. Field keys map 1:1 onto the model fields the backend whitelists.
 */
const KINDS = [
  {
    kind: 'fd',
    label: 'Fixed Deposits',
    singular: 'Fixed Deposit',
    fields: [
      { key: 'name', label: 'Bank Name', type: 'text', required: true },
      { key: 'principal', label: 'Principal', type: 'number' },
      { key: 'interestRate', label: 'Interest Rate (%)', type: 'number' },
      {
        key: 'compounding',
        label: 'Compounding',
        type: 'select',
        options: ['monthly', 'quarterly', 'yearly'],
        default: 'yearly',
      },
      { key: 'startDate', label: 'Start Date', type: 'date' },
      { key: 'tenureMonths', label: 'Tenure (months)', type: 'number' },
      { key: 'currentValue', label: 'Maturity Value (optional)', type: 'number' },
    ],
  },
  {
    kind: 'bank',
    label: 'Bank Accounts',
    singular: 'Bank Account',
    fields: [
      { key: 'name', label: 'Bank Name', type: 'text', required: true },
      {
        key: 'accountType',
        label: 'Account Type',
        type: 'select',
        options: ['savings', 'current', 'salary'],
        default: 'savings',
      },
      { key: 'currentBalance', label: 'Current Balance', type: 'number' },
    ],
  },
  {
    kind: 'mutual_fund',
    label: 'Mutual Funds',
    singular: 'Mutual Fund',
    fields: [
      { key: 'name', label: 'Fund Name', type: 'text', required: true },
      { key: 'units', label: 'Units', type: 'number' },
      { key: 'buyPrice', label: 'Avg Buy NAV', type: 'number' },
      { key: 'currentPrice', label: 'Current NAV', type: 'number' },
    ],
  },
  {
    kind: 'stock',
    label: 'Stocks',
    singular: 'Stock',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'symbol', label: 'Symbol', type: 'text' },
      { key: 'units', label: 'Quantity', type: 'number' },
      { key: 'buyPrice', label: 'Buy Price', type: 'number' },
      { key: 'currentPrice', label: 'Current Price', type: 'number' },
    ],
  },
  {
    kind: 'crypto',
    label: 'Crypto',
    singular: 'Crypto',
    fields: [
      { key: 'name', label: 'Coin', type: 'text', required: true },
      { key: 'symbol', label: 'Symbol', type: 'text' },
      { key: 'units', label: 'Quantity', type: 'number' },
      { key: 'buyPrice', label: 'Buy Price', type: 'number' },
      { key: 'currentPrice', label: 'Current Price', type: 'number' },
    ],
  },
  {
    kind: 'ppf_epf',
    label: 'PPF / EPF',
    singular: 'PPF / EPF',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      {
        key: 'accountType',
        label: 'Account Type',
        type: 'select',
        options: ['PPF', 'EPF'],
        default: 'PPF',
      },
      { key: 'currentBalance', label: 'Corpus', type: 'number' },
      { key: 'yearlyContribution', label: 'Yearly Contribution', type: 'number' },
    ],
  },
  {
    kind: 'real_estate',
    label: 'Real Estate',
    singular: 'Property',
    fields: [
      { key: 'name', label: 'Property', type: 'text', required: true },
      { key: 'principal', label: 'Purchase Value', type: 'number' },
      { key: 'currentValue', label: 'Current Est. Value', type: 'number' },
    ],
  },
  {
    kind: 'gold',
    label: 'Gold',
    singular: 'Gold',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, default: 'Gold' },
      { key: 'units', label: 'Grams', type: 'number' },
      { key: 'buyPrice', label: 'Buy Price (per gram)', type: 'number' },
      { key: 'currentPrice', label: 'Current Price (per gram)', type: 'number' },
    ],
  },
];

const KIND_LABEL = KINDS.reduce((acc, k) => {
  acc[k.kind] = k.label;
  return acc;
}, {});

/** Stable palette for the allocation pie, indexed by slice order. */
const PIE_COLORS = [
  '#6366f1', // indigo
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#14b8a6', // teal
];

/** Build a blank form for a kind: selects take their default, others ''. */
function emptyFormFor(config) {
  const form = {};
  for (const field of config.fields) {
    if (field.type === 'select') {
      form[field.key] = field.default ?? field.options[0];
    } else {
      form[field.key] = field.default ?? '';
    }
  }
  return form;
}

/** Populate a form from an existing item, stringifying numbers and dates. */
function formFromItem(config, item) {
  const form = {};
  for (const field of config.fields) {
    const value = item[field.key];
    if (field.type === 'number') {
      form[field.key] = value === null || value === undefined ? '' : String(value);
    } else if (field.type === 'date') {
      form[field.key] = value ? String(value).slice(0, 10) : '';
    } else if (field.type === 'select') {
      form[field.key] = value ?? field.default ?? field.options[0];
    } else {
      form[field.key] = value ?? '';
    }
  }
  return form;
}

export default function Portfolio() {
  const { displayCurrency, format } = useDisplayCurrency();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [activeKind, setActiveKind] = useState('stock');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data } = await apiClient.get('/portfolio/summary');
      setSummary(data);
    } catch (err) {
      setError(extractError(err, 'Unable to load portfolio'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const config = useMemo(
    () => KINDS.find((k) => k.kind === activeKind) ?? KINDS[0],
    [activeKind],
  );

  // Group computed items by kind for the per-section tables.
  const itemsByKind = useMemo(() => {
    const map = {};
    for (const k of KINDS) map[k.kind] = [];
    for (const item of summary?.items ?? []) {
      if (!map[item.kind]) map[item.kind] = [];
      map[item.kind].push(item);
    }
    return map;
  }, [summary]);

  const pieData = useMemo(
    () =>
      (summary?.allocation ?? []).map((slice) => ({
        name: KIND_LABEL[slice.kind] ?? slice.kind,
        value: slice.value,
        percent: slice.percent,
      })),
    [summary],
  );

  function openCreate(kind) {
    setActiveKind(kind);
    const cfg = KINDS.find((k) => k.kind === kind) ?? KINDS[0];
    setEditing(null);
    setForm(emptyFormFor(cfg));
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(item) {
    const cfg = KINDS.find((k) => k.kind === item.kind) ?? KINDS[0];
    setActiveKind(item.kind);
    setEditing(item);
    setForm(formFromItem(cfg, item));
    setFormError(null);
    setModalOpen(true);
  }

  function validate() {
    if (!String(form.name ?? '').trim()) return 'Name is required.';
    if (String(form.name).length > 100) return 'Name must be 1 to 100 characters.';
    for (const field of config.fields) {
      if (field.type !== 'number') continue;
      const raw = form[field.key];
      if (raw === '' || raw === undefined || raw === null) continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        return `${field.label} must be a valid number.`;
      }
    }
    return null;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;
    const message = validate();
    if (message) {
      setFormError(message);
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const payload = { kind: activeKind };
      for (const field of config.fields) {
        const raw = form[field.key];
        if (field.type === 'number') {
          if (raw !== '' && raw !== undefined && raw !== null) {
            payload[field.key] = Number(raw);
          }
        } else if (field.type === 'date') {
          if (raw) payload[field.key] = raw;
        } else {
          // Free-text (text fields like name/symbol/notes). Sanitize before
          // sending; select/enum values use the branch above and are left as-is.
          payload[field.key] = typeof raw === 'string' ? sanitizeInput(raw.trim()) : raw;
        }
      }

      if (editing) {
        await apiClient.put(`/portfolio/${editing._id}`, payload);
      } else {
        await apiClient.post('/portfolio', payload);
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(extractError(err, 'Unable to save item'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(item) {
    if (typeof window !== 'undefined' && !window.confirm(`Delete ${item.name}?`)) return;
    try {
      await apiClient.delete(`/portfolio/${item._id}`);
      await load();
    } catch (err) {
      setError(extractError(err, 'Unable to delete item'));
    }
  }

  if (loading) return <PortfolioSkeleton />;

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Portfolio</h1>
          <p className="text-sm text-slate-600">
            Every holding in one place. Invested, value, and returns computed per request.
          </p>
        </div>
      </header>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {summary && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SummaryCard
            label="Total value"
            value={format(summary.totalCurrentValue)}
          />
          <SummaryCard
            label="Total invested"
            value={format(summary.totalInvested)}
          />
          <SummaryCard
            label="Total returns"
            value={format(summary.totalReturns)}
            tone={summary.totalReturns >= 0 ? 'positive' : 'negative'}
          />
        </div>
      )}

      {pieData.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">
            Asset allocation
          </h2>
          <div className="mt-2 h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  label={(entry) => `${entry.name} (${entry.percent}%)`}
                >
                  {pieData.map((entry, index) => (
                    <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value) => format(value)}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (summary?.items ?? []).length === 0 ? (
        <EmptyState
          message="Portfolio is empty. Add your assets."
          actionLabel="Add holding"
          onAction={() => openCreate('stock')}
        />
      ) : (
        <div className="space-y-6">
          {KINDS.map((cfg) => (
            <KindSection
              key={cfg.kind}
              config={cfg}
              items={itemsByKind[cfg.kind] ?? []}
              format={format}
              onAdd={() => openCreate(cfg.kind)}
              onEdit={openEdit}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        title={editing ? `Edit ${config.singular}` : `New ${config.singular}`}
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="portfolio-form"
              disabled={submitting}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:bg-indigo-400"
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        <form id="portfolio-form" onSubmit={handleSubmit} className="space-y-3">
          {formError && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError}
            </p>
          )}
          {config.fields.map((field) => (
            <Field
              key={field.key}
              label={field.label}
              htmlFor={`pf-${field.key}`}
            >
              {field.type === 'select' ? (
                <select
                  id={`pf-${field.key}`}
                  value={form[field.key] ?? ''}
                  onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                  className={inputClass}
                >
                  {field.options.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={`pf-${field.key}`}
                  type={field.type}
                  {...(field.type === 'number' ? { step: 'any', min: '0' } : {})}
                  {...(field.required ? { required: true, maxLength: 100 } : {})}
                  value={form[field.key] ?? ''}
                  onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                  className={inputClass}
                />
              )}
            </Field>
          ))}
        </form>
      </Modal>
    </section>
  );
}

function KindSection({ config, items, format, onAdd, onEdit, onDelete }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-base font-semibold text-slate-900">{config.label}</h2>
        <button
          type="button"
          onClick={onAdd}
          className="flex min-h-[40px] items-center justify-center rounded-md bg-indigo-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
        >
          Add
        </button>
      </div>

      {items.length === 0 ? (
        <p className="px-4 py-4 text-sm text-slate-500">No {config.label.toLowerCase()} yet.</p>
      ) : (
        <>
          {/* Desktop / tablet: table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                    Name
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-500">
                    Invested
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-500">
                    Value
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-500">
                    Returns
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {items.map((item) => (
                  <tr key={item._id}>
                    <td className="px-4 py-2">
                      <div className="font-medium text-slate-900">{item.name}</div>
                      {item.symbol && <div className="text-xs text-slate-500">{item.symbol}</div>}
                      {!item.symbol && item.accountType && (
                        <div className="text-xs text-slate-500">{item.accountType}</div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {format(item.invested)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {format(item.currentValue)}
                    </td>
                    <td
                      className={`px-4 py-2 text-right tabular-nums ${
                        item.returns >= 0 ? 'text-emerald-600' : 'text-red-600'
                      }`}
                    >
                      {format(item.returns)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => onEdit(item)}
                          className="text-xs font-medium text-indigo-600 hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(item)}
                          className="text-xs font-medium text-red-600 hover:underline"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: scrollable card list */}
          <ul className="max-h-[70vh] space-y-3 overflow-y-auto p-3 md:hidden">
            {items.map((item) => (
              <li
                key={item._id}
                className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-900">{item.name}</div>
                    {(item.symbol || item.accountType) && (
                      <div className="truncate text-xs text-slate-500">
                        {item.symbol || item.accountType}
                      </div>
                    )}
                  </div>
                  <div
                    className={`shrink-0 text-right text-base font-semibold tabular-nums whitespace-nowrap ${
                      item.returns >= 0 ? 'text-emerald-600' : 'text-red-600'
                    }`}
                  >
                    {format(item.returns)}
                    <div className="text-xs font-normal text-slate-400">returns</div>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600">
                  <div>
                    <span className="text-slate-400">Invested </span>
                    <span className="tabular-nums">{format(item.invested)}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-slate-400">Value </span>
                    <span className="tabular-nums">{format(item.currentValue)}</span>
                  </div>
                </div>
                <div className="mt-3 flex gap-2 border-t border-slate-100 pt-2">
                  <button
                    type="button"
                    onClick={() => onEdit(item)}
                    className="flex min-h-[44px] flex-1 items-center justify-center rounded-md border border-slate-300 text-sm font-medium text-indigo-600 hover:bg-slate-50"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(item)}
                    className="flex min-h-[44px] flex-1 items-center justify-center rounded-md border border-slate-300 text-sm font-medium text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, value, tone = 'neutral' }) {
  const toneClass =
    tone === 'positive'
      ? 'text-emerald-600'
      : tone === 'negative'
        ? 'text-red-600'
        : 'text-slate-900';
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div
        className={`mt-2 break-words text-xl font-semibold leading-tight tabular-nums sm:text-2xl ${toneClass}`}
      >
        {value}
      </div>
    </div>
  );
}
