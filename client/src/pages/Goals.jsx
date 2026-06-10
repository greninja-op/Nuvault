import { useEffect, useState } from 'react';
import apiClient from '../api/client';
import Field, { inputClass } from '../components/Field';
import Modal from '../components/Modal';
import { useDisplayCurrency } from '../currency/CurrencyContext';
import { extractError, formatCurrency } from '../lib/format';

const EMPTY_FORM = { name: '', targetAmount: '', targetDate: '', category: '' };

/**
 * Goals list with create/contribute/delete. The backend's PUT endpoint
 * uses additive contribution semantics (`{ amount }`), not field
 * replacement — see goalController.js. This view exposes the same
 * semantics: a goal can be created or removed, and its `savedAmount`
 * grows via positive contributions.
 *
 * Backend endpoints:
 *   GET    /goals
 *   POST   /goals
 *   PUT    /goals/:id  body: { amount }
 *   DELETE /goals/:id
 */
export default function Goals() {
  const { displayCurrency } = useDisplayCurrency();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [contribOpen, setContribOpen] = useState(false);
  const [contribTarget, setContribTarget] = useState(null);
  const [contribAmount, setContribAmount] = useState('');
  const [contribError, setContribError] = useState(null);
  const [contribSubmitting, setContribSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data } = await apiClient.get('/goals');
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(extractError(err, 'Unable to load goals'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setForm(EMPTY_FORM);
    setFormError(null);
    setCreateOpen(true);
  }

  function validateCreate() {
    if (!form.name.trim()) return 'Name is required.';
    if (form.name.length > 100) return 'Name must be 1 to 100 characters.';
    const num = Number(form.targetAmount);
    if (!Number.isFinite(num) || num < 0.01 || num > 999999999.99) {
      return 'Target amount must be between 0.01 and 999,999,999.99.';
    }
    return null;
  }

  async function handleCreate(event) {
    event.preventDefault();
    if (submitting) return;
    const message = validateCreate();
    if (message) {
      setFormError(message);
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const payload = {
        name: form.name.trim(),
        targetAmount: Number(form.targetAmount),
      };
      if (form.targetDate) payload.targetDate = form.targetDate;
      if (form.category) payload.category = form.category;
      await apiClient.post('/goals', payload);
      setCreateOpen(false);
      await load();
    } catch (err) {
      setFormError(extractError(err, 'Unable to create goal'));
    } finally {
      setSubmitting(false);
    }
  }

  function openContribute(goal) {
    setContribTarget(goal);
    setContribAmount('');
    setContribError(null);
    setContribOpen(true);
  }

  async function handleContribute(event) {
    event.preventDefault();
    if (contribSubmitting || !contribTarget) return;
    const num = Number(contribAmount);
    if (!Number.isFinite(num) || num < 0.01 || num > 999999999.99) {
      setContribError('Amount must be between 0.01 and 999,999,999.99.');
      return;
    }
    setContribSubmitting(true);
    setContribError(null);
    try {
      await apiClient.put(`/goals/${contribTarget._id}`, { amount: num });
      setContribOpen(false);
      await load();
    } catch (err) {
      setContribError(extractError(err, 'Unable to record contribution'));
    } finally {
      setContribSubmitting(false);
    }
  }

  async function handleDelete(goal) {
    if (typeof window !== 'undefined' && !window.confirm(`Delete goal ${goal.name}?`)) return;
    try {
      await apiClient.delete(`/goals/${goal._id}`);
      await load();
    } catch (err) {
      setError(extractError(err, 'Unable to delete goal'));
    }
  }

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Goals</h1>
          <p className="text-sm text-slate-600">
            Track progress toward savings targets.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
        >
          New goal
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
        <p className="text-sm text-slate-500">No goals yet.</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {items.map((goal) => {
            const progress = Math.min(Number(goal.progress) || 0, 1);
            const percent = Math.round(progress * 100);
            return (
              <li
                key={goal._id}
                className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-slate-900">{goal.name}</div>
                    {goal.category && (
                      <div className="text-xs text-slate-500">{goal.category}</div>
                    )}
                  </div>
                  <div className="text-right text-sm text-slate-700">
                    {formatCurrency(goal.savedAmount, displayCurrency)} /{' '}
                    {formatCurrency(goal.targetAmount, displayCurrency)}
                  </div>
                </div>
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full bg-indigo-500"
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <div className="mt-2 text-xs text-slate-500">{percent}% saved</div>
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => openContribute(goal)}
                    className="text-xs font-medium text-indigo-600 hover:underline"
                  >
                    Contribute
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(goal)}
                    className="text-xs font-medium text-red-600 hover:underline"
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
        open={createOpen}
        title="New goal"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="goal-form"
              disabled={submitting}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:bg-indigo-400"
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        <form id="goal-form" onSubmit={handleCreate} className="space-y-3">
          {formError && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError}
            </p>
          )}
          <Field label="Name" htmlFor="goal-name">
            <input
              id="goal-name"
              type="text"
              required
              maxLength={100}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Target amount" htmlFor="goal-target">
            <input
              id="goal-target"
              type="number"
              step="0.01"
              min="0.01"
              max="999999999.99"
              required
              value={form.targetAmount}
              onChange={(e) => setForm({ ...form, targetAmount: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Target date" htmlFor="goal-date">
            <input
              id="goal-date"
              type="date"
              value={form.targetDate}
              onChange={(e) => setForm({ ...form, targetDate: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Category" htmlFor="goal-category">
            <input
              id="goal-category"
              type="text"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className={inputClass}
            />
          </Field>
        </form>
      </Modal>

      <Modal
        open={contribOpen}
        title={`Contribute to ${contribTarget?.name ?? ''}`}
        onClose={() => setContribOpen(false)}
        footer={
          <>
            <button
              type="button"
              onClick={() => setContribOpen(false)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="goal-contrib-form"
              disabled={contribSubmitting}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:bg-indigo-400"
            >
              {contribSubmitting ? 'Saving…' : 'Add'}
            </button>
          </>
        }
      >
        <form id="goal-contrib-form" onSubmit={handleContribute} className="space-y-3">
          {contribError && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {contribError}
            </p>
          )}
          <Field label="Amount" htmlFor="contrib-amount" hint="Adds to the saved amount.">
            <input
              id="contrib-amount"
              type="number"
              step="0.01"
              min="0.01"
              max="999999999.99"
              required
              value={contribAmount}
              onChange={(e) => setContribAmount(e.target.value)}
              className={inputClass}
            />
          </Field>
        </form>
      </Modal>
    </section>
  );
}
