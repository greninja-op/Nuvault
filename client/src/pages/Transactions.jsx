import { useEffect, useState } from 'react';
import apiClient from '../api/client';
import Field, { inputClass } from '../components/Field';
import Modal from '../components/Modal';
import { useDisplayCurrency } from '../currency/CurrencyContext';
import { extractError, formatCurrency, formatDate } from '../lib/format';

const TYPES = ['income', 'expense'];

const EMPTY_FORM = {
  type: 'expense',
  category: '',
  amount: '',
  description: '',
  date: '',
};

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Transactions list with optional month/year filter and a category-grouped
 * income/expense summary card. Backend endpoints:
 *   GET    /transactions?month=&year=
 *   GET    /transactions/summary?month=&year=
 *   POST   /transactions
 *   PUT    /transactions/:id
 *   DELETE /transactions/:id
 */
export default function Transactions() {
  const { displayCurrency, format } = useDisplayCurrency();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [filterEnabled, setFilterEnabled] = useState(true);

  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({ income: [], expense: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = filterEnabled ? { month, year } : {};
      const [list, summaryRes] = await Promise.all([
        apiClient.get('/transactions', { params }),
        apiClient.get('/transactions/summary', { params }),
      ]);
      setItems(Array.isArray(list.data) ? list.data : []);
      setSummary({
        income: summaryRes.data?.income ?? [],
        expense: summaryRes.data?.expense ?? [],
      });
    } catch (err) {
      setError(extractError(err, 'Unable to load transactions'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, year, filterEnabled]);

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, date: new Date().toISOString().slice(0, 10) });
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(tx) {
    setEditing(tx);
    setForm({
      type: tx.type ?? 'expense',
      category: tx.category ?? '',
      amount: String(tx.amount ?? ''),
      description: tx.description ?? '',
      date: tx.date ? tx.date.slice(0, 10) : '',
    });
    setFormError(null);
    setModalOpen(true);
  }

  function validate() {
    if (!TYPES.includes(form.type)) return 'Type is invalid.';
    if (!form.category.trim()) return 'Category is required.';
    if (form.category.length > 100) return 'Category must be 1 to 100 characters.';
    const num = Number(form.amount);
    if (!Number.isFinite(num) || num <= 0) return 'Amount must be greater than 0.';
    if (num > 999999999.99) return 'Amount must be at most 999,999,999.99.';
    if (Number(num.toFixed(2)) !== num) return 'Amount must have at most 2 decimal places.';
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
      const payload = {
        type: form.type,
        category: form.category.trim(),
        amount: Number(form.amount),
        description: form.description,
      };
      if (form.date) payload.date = form.date;

      if (editing) {
        await apiClient.put(`/transactions/${editing._id}`, payload);
      } else {
        await apiClient.post('/transactions', payload);
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(extractError(err, 'Unable to save transaction'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(tx) {
    if (typeof window !== 'undefined' && !window.confirm('Delete this transaction?')) return;
    try {
      await apiClient.delete(`/transactions/${tx._id}`);
      await load();
    } catch (err) {
      setError(extractError(err, 'Unable to delete transaction'));
    }
  }

  const totalIncome = summary.income.reduce((s, x) => s + Number(x.total || 0), 0);
  const totalExpense = summary.expense.reduce((s, x) => s + Number(x.total || 0), 0);

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Transactions</h1>
          <p className="text-sm text-slate-600">Track income and expenses.</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="flex min-h-[44px] w-full items-center justify-center rounded-md bg-indigo-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 sm:w-auto"
        >
          New transaction
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={filterEnabled}
            onChange={(e) => setFilterEnabled(e.target.checked)}
          />
          <span>Filter by month</span>
        </label>
        <select
          aria-label="Month"
          value={month}
          disabled={!filterEnabled}
          onChange={(e) => setMonth(Number(e.target.value))}
          className={inputClass + ' max-w-[8rem]'}
        >
          {MONTHS.map((label, idx) => (
            <option key={label} value={idx + 1}>{label}</option>
          ))}
        </select>
        <input
          type="number"
          aria-label="Year"
          value={year}
          disabled={!filterEnabled}
          min={1970}
          max={9999}
          onChange={(e) => setYear(Number(e.target.value))}
          className={inputClass + ' max-w-[6rem]'}
        />
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SummaryColumn
          title="Income by category"
          rows={summary.income}
          total={totalIncome}
          format={format}
        />
        <SummaryColumn
          title="Expense by category"
          rows={summary.expense}
          total={totalExpense}
          format={format}
        />
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500">No transactions in this period.</p>
      ) : (
        <>
          {/* Desktop / tablet: table */}
          <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm md:block">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Date</th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Type</th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Category</th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Description</th>
                  <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-500">Amount</th>
                  <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {items.map((tx) => (
                  <tr key={tx._id}>
                    <td className="px-4 py-2 text-slate-600">{formatDate(tx.date)}</td>
                    <td className="px-4 py-2">
                      <TypeBadge type={tx.type} />
                    </td>
                    <td className="px-4 py-2">{tx.category}</td>
                    <td className="px-4 py-2 text-slate-600">{tx.description || '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {format(tx.amount)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(tx)}
                          className="text-xs font-medium text-indigo-600 hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(tx)}
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

          {/* Mobile: card list */}
          <ul className="space-y-3 md:hidden">
            {items.map((tx) => (
              <li
                key={tx._id}
                className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <TypeBadge type={tx.type} />
                      <span className="truncate font-medium text-slate-900">
                        {tx.category}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {formatDate(tx.date)}
                    </div>
                    {tx.description && (
                      <div className="mt-1 break-words text-sm text-slate-600">
                        {tx.description}
                      </div>
                    )}
                  </div>
                  <div
                    className={`shrink-0 text-right text-base font-semibold tabular-nums whitespace-nowrap ${
                      tx.type === 'income' ? 'text-emerald-600' : 'text-slate-900'
                    }`}
                  >
                    {format(tx.amount)}
                  </div>
                </div>
                <div className="mt-3 flex gap-2 border-t border-slate-100 pt-2">
                  <button
                    type="button"
                    onClick={() => openEdit(tx)}
                    className="flex min-h-[44px] flex-1 items-center justify-center rounded-md border border-slate-300 text-sm font-medium text-indigo-600 hover:bg-slate-50"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(tx)}
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

      <Modal
        open={modalOpen}
        title={editing ? 'Edit transaction' : 'New transaction'}
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
              form="transaction-form"
              disabled={submitting}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:bg-indigo-400"
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        <form id="transaction-form" onSubmit={handleSubmit} className="space-y-3">
          {formError && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError}
            </p>
          )}
          <Field label="Type" htmlFor="tx-type">
            <select
              id="tx-type"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              className={inputClass}
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Category" htmlFor="tx-category">
            <input
              id="tx-category"
              type="text"
              required
              maxLength={100}
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Amount" htmlFor="tx-amount" hint="Greater than 0, up to 2 decimal places">
            <input
              id="tx-amount"
              type="number"
              step="0.01"
              min="0.01"
              max="999999999.99"
              required
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Date" htmlFor="tx-date">
            <input
              id="tx-date"
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Description" htmlFor="tx-desc">
            <textarea
              id="tx-desc"
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className={inputClass}
            />
          </Field>
        </form>
      </Modal>
    </section>
  );
}

function TypeBadge({ type }) {
  return (
    <span
      className={
        type === 'income'
          ? 'rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700'
          : 'rounded bg-red-50 px-2 py-0.5 text-xs text-red-700'
      }
    >
      {type}
    </span>
  );
}

function SummaryColumn({ title, rows, total, format }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <span className="text-sm font-medium text-slate-700 tabular-nums whitespace-nowrap">
          {format(total)}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No data.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100 text-sm">
          {rows.map((row) => (
            <li key={row.category} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 truncate text-slate-700">{row.category}</span>
              <span className="shrink-0 text-slate-900 tabular-nums whitespace-nowrap">
                {format(row.total)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
