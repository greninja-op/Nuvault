import { useEffect, useState } from 'react';
import apiClient from '../api/client';
import Field, { inputClass } from '../components/Field';
import Modal from '../components/Modal';
import { useDisplayCurrency } from '../currency/CurrencyContext';
import { extractError, formatCurrency } from '../lib/format';
import { sanitizeInput } from '../utils/sanitize';
import BudgetSkeleton from '../components/skeletons/BudgetSkeleton';
import EmptyState from '../components/EmptyState';

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const EMPTY_FORM = { category: '', limit: '', month: 1, year: new Date().getFullYear() };

/**
 * Budgets list with month/year filter and create/edit/delete via a modal.
 * Each row shows the limit, computed `spent`, `remaining`, and the
 * `overBudget` flag returned by the API.
 *
 * Backend endpoints:
 *   GET    /budgets?month=&year=
 *   POST   /budgets
 *   PUT    /budgets/:id
 *   DELETE /budgets/:id
 */
export default function Budgets() {
  const { displayCurrency, format } = useDisplayCurrency();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  const [items, setItems] = useState([]);
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
      const { data } = await apiClient.get('/budgets', { params: { month, year } });
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(extractError(err, 'Unable to load budgets'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, year]);

  function openCreate() {
    setEditing(null);
    setForm({ category: '', limit: '', month, year });
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(budget) {
    setEditing(budget);
    setForm({
      category: budget.category ?? '',
      limit: String(budget.limit ?? ''),
      month: budget.month ?? month,
      year: budget.year ?? year,
    });
    setFormError(null);
    setModalOpen(true);
  }

  function validate() {
    if (!form.category.trim()) return 'Category is required.';
    if (form.category.length > 100) return 'Category must be 1 to 100 characters.';
    const num = Number(form.limit);
    if (!Number.isFinite(num) || num <= 0) return 'Limit must be greater than 0.';
    if (num > 999999999.99) return 'Limit must be at most 999,999,999.99.';
    if (!Number.isInteger(form.month) || form.month < 1 || form.month > 12) {
      return 'Month must be between 1 and 12.';
    }
    if (!Number.isInteger(form.year) || form.year < 1970 || form.year > 2100) {
      return 'Year must be between 1970 and 2100.';
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
      const payload = {
        category: sanitizeInput(form.category.trim()),
        limit: Number(form.limit),
        month: form.month,
        year: form.year,
      };
      if (editing) {
        await apiClient.put(`/budgets/${editing._id}`, payload);
      } else {
        await apiClient.post('/budgets', payload);
      }
      setModalOpen(false);
      // If the saved budget belongs to a different period, jump there.
      if (form.month !== month || form.year !== year) {
        setMonth(form.month);
        setYear(form.year);
      } else {
        await load();
      }
    } catch (err) {
      setFormError(extractError(err, 'Unable to save budget'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(budget) {
    if (typeof window !== 'undefined' && !window.confirm(`Delete budget for ${budget.category}?`)) {
      return;
    }
    try {
      await apiClient.delete(`/budgets/${budget._id}`);
      await load();
    } catch (err) {
      setError(extractError(err, 'Unable to delete budget'));
    }
  }

  if (loading) return <BudgetSkeleton />;

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Budgets</h1>
          <p className="text-sm text-slate-600">Per-category spending limits.</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="flex min-h-[44px] w-full items-center justify-center rounded-md bg-indigo-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 sm:w-auto"
        >
          New budget
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <select
          aria-label="Month"
          value={month}
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
          min={1970}
          max={2100}
          onChange={(e) => setYear(Number(e.target.value))}
          className={inputClass + ' max-w-[6rem]'}
        />
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : items.length === 0 ? (
        <EmptyState
          message="No budgets set. Create your first budget."
          actionLabel="New budget"
          onAction={openCreate}
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((budget) => {
            const limit = Number(budget.limit) || 0;
            const spent = Number(budget.spent) || 0;
            const ratio = limit > 0 ? Math.min(spent / limit, 1) : 0;
            return (
              <li
                key={budget._id}
                className="flex flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-900">{budget.category}</div>
                    <div className="text-xs text-slate-500">
                      {MONTHS[budget.month - 1]} {budget.year}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-slate-700 tabular-nums whitespace-nowrap">
                      {format(spent)} of{' '}
                      {format(limit)}
                    </div>
                    <div
                      className={`text-xs ${budget.overBudget ? 'text-red-600' : 'text-slate-500'}`}
                    >
                      {budget.overBudget
                        ? 'Over budget'
                        : `${format(budget.remaining)} remaining`}
                    </div>
                  </div>
                </div>
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full ${budget.overBudget ? 'bg-red-500' : 'bg-indigo-500'}`}
                    style={{ width: `${Math.round(ratio * 100)}%` }}
                  />
                </div>
                <div className="mt-3 flex justify-end gap-2 border-t border-slate-100 pt-3">
                  <button
                    type="button"
                    onClick={() => openEdit(budget)}
                    className="flex min-h-[44px] items-center justify-center rounded-md border border-slate-300 px-4 text-sm font-medium text-indigo-600 hover:bg-slate-50"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(budget)}
                    className="flex min-h-[44px] items-center justify-center rounded-md border border-slate-300 px-4 text-sm font-medium text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        open={modalOpen}
        title={editing ? 'Edit budget' : 'New budget'}
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
              form="budget-form"
              disabled={submitting}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:bg-indigo-400"
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        <form id="budget-form" onSubmit={handleSubmit} className="space-y-3">
          {formError && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError}
            </p>
          )}
          <Field label="Category" htmlFor="budget-category">
            <input
              id="budget-category"
              type="text"
              required
              maxLength={100}
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Limit" htmlFor="budget-limit">
            <input
              id="budget-limit"
              type="number"
              step="0.01"
              min="0.01"
              max="999999999.99"
              required
              value={form.limit}
              onChange={(e) => setForm({ ...form, limit: e.target.value })}
              className={inputClass}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Month" htmlFor="budget-month">
              <select
                id="budget-month"
                value={form.month}
                onChange={(e) => setForm({ ...form, month: Number(e.target.value) })}
                className={inputClass}
              >
                {MONTHS.map((label, idx) => (
                  <option key={label} value={idx + 1}>{label}</option>
                ))}
              </select>
            </Field>
            <Field label="Year" htmlFor="budget-year">
              <input
                id="budget-year"
                type="number"
                min="1970"
                max="2100"
                required
                value={form.year}
                onChange={(e) => setForm({ ...form, year: Number(e.target.value) })}
                className={inputClass}
              />
            </Field>
          </div>
        </form>
      </Modal>
    </section>
  );
}
