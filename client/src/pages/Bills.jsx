import { useEffect, useState } from 'react';
import apiClient from '../api/client';
import Field, { inputClass } from '../components/Field';
import Modal from '../components/Modal';
import { useDisplayCurrency } from '../currency/CurrencyContext';
import { extractError, formatCurrency, formatDate } from '../lib/format';

const FREQUENCIES = ['monthly', 'weekly', 'yearly', 'one-time'];

const EMPTY_FORM = {
  name: '',
  amount: '',
  frequency: 'monthly',
  nextDueDate: '',
  category: '',
  autoPay: false,
  isPaid: false,
};

/**
 * Bills list with create/edit/delete and a "Pay" action that calls
 * `PATCH /bills/:id/pay`. The backend handles advancement for recurring
 * bills and one-time settlement; the client simply re-fetches.
 */
export default function Bills() {
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
      const { data } = await apiClient.get('/bills');
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(extractError(err, 'Unable to load bills'));
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

  function openEdit(bill) {
    setEditing(bill);
    setForm({
      name: bill.name ?? '',
      amount: String(bill.amount ?? ''),
      frequency: bill.frequency ?? 'monthly',
      nextDueDate: bill.nextDueDate ? bill.nextDueDate.slice(0, 10) : '',
      category: bill.category ?? '',
      autoPay: Boolean(bill.autoPay),
      isPaid: Boolean(bill.isPaid),
    });
    setFormError(null);
    setModalOpen(true);
  }

  function validate() {
    if (!form.name.trim()) return 'Name is required.';
    if (form.name.length > 100) return 'Name must be 1 to 100 characters.';
    const num = Number(form.amount);
    if (!Number.isFinite(num) || num <= 0 || num > 999999999.99) {
      return 'Amount must be greater than 0.';
    }
    if (Number(num.toFixed(2)) !== num) {
      return 'Amount must have at most 2 decimal places.';
    }
    if (!FREQUENCIES.includes(form.frequency)) return 'Frequency is invalid.';
    if (!form.nextDueDate) return 'Next due date is required.';
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
        amount: Number(form.amount),
        frequency: form.frequency,
        nextDueDate: form.nextDueDate,
        category: form.category,
        autoPay: form.autoPay,
        isPaid: form.isPaid,
      };
      if (editing) {
        await apiClient.put(`/bills/${editing._id}`, payload);
      } else {
        await apiClient.post('/bills', payload);
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(extractError(err, 'Unable to save bill'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(bill) {
    if (typeof window !== 'undefined' && !window.confirm(`Delete ${bill.name}?`)) return;
    try {
      await apiClient.delete(`/bills/${bill._id}`);
      await load();
    } catch (err) {
      setError(extractError(err, 'Unable to delete bill'));
    }
  }

  async function handlePay(bill) {
    setError(null);
    try {
      await apiClient.patch(`/bills/${bill._id}/pay`);
      await load();
    } catch (err) {
      setError(extractError(err, 'Unable to mark bill paid'));
    }
  }

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Bills</h1>
          <p className="text-sm text-slate-600">
            Recurring and one-time payment obligations.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
        >
          New bill
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
        <p className="text-sm text-slate-500">No bills yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Name</th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Frequency</th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Next due</th>
                <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-500">Amount</th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Status</th>
                <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {items.map((bill) => (
                <tr key={bill._id}>
                  <td className="px-4 py-2">
                    <div className="font-medium text-slate-900">{bill.name}</div>
                    {bill.category && (
                      <div className="text-xs text-slate-500">{bill.category}</div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-600">{bill.frequency}</td>
                  <td className="px-4 py-2 text-slate-600">{formatDate(bill.nextDueDate)}</td>
                  <td className="px-4 py-2 text-right">
                    {formatCurrency(bill.amount, displayCurrency)}
                  </td>
                  <td className="px-4 py-2">
                    {bill.isPaid ? (
                      <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                        Paid
                      </span>
                    ) : (
                      <span className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                        Due
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => handlePay(bill)}
                        disabled={bill.frequency === 'one-time' && bill.isPaid}
                        className="text-xs font-medium text-emerald-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
                      >
                        Pay
                      </button>
                      <button
                        type="button"
                        onClick={() => openEdit(bill)}
                        className="text-xs font-medium text-indigo-600 hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(bill)}
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
      )}

      <Modal
        open={modalOpen}
        title={editing ? 'Edit bill' : 'New bill'}
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
              form="bill-form"
              disabled={submitting}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:bg-indigo-400"
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        <form id="bill-form" onSubmit={handleSubmit} className="space-y-3">
          {formError && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError}
            </p>
          )}
          <Field label="Name" htmlFor="bill-name">
            <input
              id="bill-name"
              type="text"
              required
              maxLength={100}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Amount" htmlFor="bill-amount">
            <input
              id="bill-amount"
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
          <div className="grid grid-cols-2 gap-3">
            <Field label="Frequency" htmlFor="bill-frequency">
              <select
                id="bill-frequency"
                value={form.frequency}
                onChange={(e) => setForm({ ...form, frequency: e.target.value })}
                className={inputClass}
              >
                {FREQUENCIES.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </Field>
            <Field label="Next due date" htmlFor="bill-due">
              <input
                id="bill-due"
                type="date"
                required
                value={form.nextDueDate}
                onChange={(e) => setForm({ ...form, nextDueDate: e.target.value })}
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Category" htmlFor="bill-category">
            <input
              id="bill-category"
              type="text"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className={inputClass}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.autoPay}
              onChange={(e) => setForm({ ...form, autoPay: e.target.checked })}
            />
            <span>Auto-pay</span>
          </label>
        </form>
      </Modal>
    </section>
  );
}
