import { useEffect, useState } from 'react';
import apiClient from '../api/client';
import Field, { inputClass } from '../components/Field';
import Modal from '../components/Modal';
import { useDisplayCurrency } from '../currency/CurrencyContext';
import { extractError, formatCurrency } from '../lib/format';

const LIABILITY_TYPES = ['loan', 'credit_card', 'mortgage', 'other'];

const EMPTY_FORM = {
  name: '',
  type: 'loan',
  amount: '',
  interestRate: '',
  dueDate: '',
  notes: '',
};

/**
 * Liabilities list with create/edit/delete via a modal form. Backend
 * endpoints: GET/POST/PUT/DELETE /liabilities — see liabilityController.
 */
export default function Liabilities() {
  const { displayCurrency } = useDisplayCurrency();
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
      const { data } = await apiClient.get('/liabilities');
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(extractError(err, 'Unable to load liabilities'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(liability) {
    setEditing(liability);
    setForm({
      name: liability.name ?? '',
      type: liability.type ?? 'loan',
      amount: String(liability.amount ?? ''),
      interestRate:
        liability.interestRate === null || liability.interestRate === undefined
          ? ''
          : String(liability.interestRate),
      dueDate: liability.dueDate ? liability.dueDate.slice(0, 10) : '',
      notes: liability.notes ?? '',
    });
    setFormError(null);
    setModalOpen(true);
  }

  function validate() {
    if (!form.name.trim()) return 'Name is required.';
    if (form.name.length > 100) return 'Name must be 1 to 100 characters.';
    if (!LIABILITY_TYPES.includes(form.type)) return 'Type is invalid.';
    const num = Number(form.amount);
    if (!Number.isFinite(num)) return 'Amount must be a number.';
    if (num < 0.01 || num > 999999999.99) {
      return 'Amount must be between 0.01 and 999,999,999.99.';
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
        name: form.name.trim(),
        type: form.type,
        amount: Number(form.amount),
        notes: form.notes,
      };
      if (form.interestRate !== '') {
        const rate = Number(form.interestRate);
        if (Number.isFinite(rate)) payload.interestRate = rate;
      }
      if (form.dueDate) payload.dueDate = form.dueDate;

      if (editing) {
        await apiClient.put(`/liabilities/${editing._id}`, payload);
      } else {
        await apiClient.post('/liabilities', payload);
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(extractError(err, 'Unable to save liability'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(liability) {
    if (typeof window !== 'undefined' && !window.confirm(`Delete ${liability.name}?`)) {
      return;
    }
    try {
      await apiClient.delete(`/liabilities/${liability._id}`);
      await load();
    } catch (err) {
      setError(extractError(err, 'Unable to delete liability'));
    }
  }

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Liabilities</h1>
          <p className="text-sm text-slate-600">Things you owe.</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="flex min-h-[44px] shrink-0 items-center justify-center rounded-md bg-indigo-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
        >
          New liability
        </button>
      </header>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500">
          No liabilities yet. Click "New liability" to add one.
        </p>
      ) : (
        <>
          {/* Desktop / tablet: table */}
          <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm md:block">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Name</th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Type</th>
                  <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-500">Amount</th>
                  <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-500">Interest %</th>
                  <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {items.map((liability) => (
                  <tr key={liability._id}>
                    <td className="px-4 py-2">{liability.name}</td>
                    <td className="px-4 py-2 text-slate-600">{liability.type}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatCurrency(liability.amount, displayCurrency)}
                    </td>
                    <td className="px-4 py-2 text-right text-slate-600">
                      {liability.interestRate ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(liability)}
                          className="text-xs font-medium text-indigo-600 hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(liability)}
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
            {items.map((liability) => (
              <li
                key={liability._id}
                className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-900">{liability.name}</div>
                    <div className="text-xs text-slate-500">
                      {liability.type}
                      {liability.interestRate != null && ` · ${liability.interestRate}%`}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-base font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                    {formatCurrency(liability.amount, displayCurrency)}
                  </div>
                </div>
                <div className="mt-3 flex gap-2 border-t border-slate-100 pt-2">
                  <button
                    type="button"
                    onClick={() => openEdit(liability)}
                    className="flex min-h-[44px] flex-1 items-center justify-center rounded-md border border-slate-300 text-sm font-medium text-indigo-600 hover:bg-slate-50"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(liability)}
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
        title={editing ? 'Edit liability' : 'New liability'}
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
              form="liability-form"
              disabled={submitting}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:bg-indigo-400"
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        <form id="liability-form" onSubmit={handleSubmit} className="space-y-3">
          {formError && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError}
            </p>
          )}
          <Field label="Name" htmlFor="liability-name">
            <input
              id="liability-name"
              type="text"
              required
              maxLength={100}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Type" htmlFor="liability-type">
            <select
              id="liability-type"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              className={inputClass}
            >
              {LIABILITY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Amount" htmlFor="liability-amount" hint="0.01 to 999,999,999.99">
            <input
              id="liability-amount"
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
          <Field label="Interest rate %" htmlFor="liability-interest">
            <input
              id="liability-interest"
              type="number"
              step="0.01"
              value={form.interestRate}
              onChange={(e) => setForm({ ...form, interestRate: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Due date" htmlFor="liability-due">
            <input
              id="liability-due"
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Notes" htmlFor="liability-notes">
            <textarea
              id="liability-notes"
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className={inputClass}
            />
          </Field>
        </form>
      </Modal>
    </section>
  );
}
