import { useEffect, useState } from 'react';
import { Skeleton } from 'boneyard-js/react';
import apiClient from '../api/client';
import Field, { inputClass } from '../components/Field';
import Modal from '../components/Modal';
import { useDisplayCurrency } from '../currency/CurrencyContext';
import { extractError, formatCurrency } from '../lib/format';

const TYPES = ['stock', 'crypto', 'mutual_fund', 'fd', 'other'];

const EMPTY_FORM = {
  type: 'stock',
  symbol: '',
  name: '',
  quantity: '',
  buyPrice: '',
  currentPrice: '',
  buyDate: '',
  notes: '',
};

/**
 * Investments list with a P&L summary card and create/edit/delete via a
 * modal form. Backend endpoints:
 *   GET    /investments              — list (raw stored fields)
 *   GET    /investments/summary      — items + totals (live priced)
 *   POST   /investments
 *   PUT    /investments/:id
 *   DELETE /investments/:id
 */
export default function Investments() {
  const { displayCurrency, format } = useDisplayCurrency();
  const [summary, setSummary] = useState(null);
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
      const { data } = await apiClient.get('/investments/summary');
      setSummary(data);
    } catch (err) {
      setError(extractError(err, 'Unable to load investments'));
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

  function openEdit(item) {
    setEditing(item);
    setForm({
      type: item.type ?? 'stock',
      symbol: item.symbol ?? '',
      name: item.name ?? '',
      quantity: String(item.quantity ?? ''),
      buyPrice: String(item.buyPrice ?? ''),
      currentPrice:
        item.currentPrice === null || item.currentPrice === undefined
          ? ''
          : String(item.currentPrice),
      buyDate: item.buyDate ? item.buyDate.slice(0, 10) : '',
      notes: item.notes ?? '',
    });
    setFormError(null);
    setModalOpen(true);
  }

  function validate() {
    if (!TYPES.includes(form.type)) return 'Type is invalid.';
    if (!form.name.trim()) return 'Name is required.';
    if (form.name.length > 100) return 'Name must be 1 to 100 characters.';
    const qty = Number(form.quantity);
    if (!Number.isFinite(qty) || qty <= 0 || qty > 999999999.99) {
      return 'Quantity must be greater than 0.';
    }
    const buy = Number(form.buyPrice);
    if (!Number.isFinite(buy) || buy <= 0 || buy > 999999999.99) {
      return 'Buy price must be greater than 0.';
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
        type: form.type,
        symbol: form.symbol.trim(),
        name: form.name.trim(),
        quantity: Number(form.quantity),
        buyPrice: Number(form.buyPrice),
        notes: form.notes,
      };
      if (form.currentPrice !== '') {
        const cp = Number(form.currentPrice);
        if (Number.isFinite(cp)) payload.currentPrice = cp;
      }
      if (form.buyDate) payload.buyDate = form.buyDate;

      if (editing) {
        await apiClient.put(`/investments/${editing._id}`, payload);
      } else {
        await apiClient.post('/investments', payload);
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(extractError(err, 'Unable to save investment'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(item) {
    if (typeof window !== 'undefined' && !window.confirm(`Delete ${item.name}?`)) return;
    try {
      await apiClient.delete(`/investments/${item._id}`);
      await load();
    } catch (err) {
      setError(extractError(err, 'Unable to delete investment'));
    }
  }

  const items = summary?.items ?? [];

  return (
    <Skeleton
      name="investments"
      loading={loading}
      animate="shimmer"
      transition={300}
      color="rgba(0,0,0,0.06)"
      darkColor="rgba(255,255,255,0.06)"
    >
    <section className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Investments</h1>
          <p className="text-sm text-slate-600">
            Holdings with live or stored pricing. P&L computed per request.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
        >
          New investment
        </button>
      </header>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {summary && (
        <div className="grid gap-4 md:grid-cols-3">
          <SummaryCard
            label="Total invested"
            value={format(summary.totalInvested)}
          />
          <SummaryCard
            label="Current value"
            value={format(summary.totalCurrentValue)}
          />
          <SummaryCard
            label="Total P&L"
            value={format(summary.totalPnL)}
            tone={summary.totalPnL >= 0 ? 'positive' : 'negative'}
          />
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500">No investments yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Name</th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Type</th>
                <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-500">Qty</th>
                <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-500">Buy price</th>
                <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-500">Current</th>
                <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-500">P&L</th>
                <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {items.map((item) => (
                <tr key={item._id}>
                  <td className="px-4 py-2">
                    <div className="font-medium text-slate-900">{item.name}</div>
                    {item.symbol && (
                      <div className="text-xs text-slate-500">{item.symbol}</div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-600">{item.type}</td>
                  <td className="px-4 py-2 text-right">{item.quantity}</td>
                  <td className="px-4 py-2 text-right">
                    {format(item.buyPrice)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {format(item.currentPrice)}
                    <div className="text-xs text-slate-500">{item.priceSource}</div>
                  </td>
                  <td
                    className={`px-4 py-2 text-right ${item.gainLoss >= 0 ? 'text-emerald-600' : 'text-red-600'}`}
                  >
                    {format(item.gainLoss)}
                    <div className="text-xs">
                      {Number(item.gainLossPercent).toFixed(2)}%
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(item)}
                        className="text-xs font-medium text-indigo-600 hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(item)}
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
        title={editing ? 'Edit investment' : 'New investment'}
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
              form="investment-form"
              disabled={submitting}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:bg-indigo-400"
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        <form id="investment-form" onSubmit={handleSubmit} className="space-y-3">
          {formError && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError}
            </p>
          )}
          <Field label="Type" htmlFor="inv-type">
            <select
              id="inv-type"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              className={inputClass}
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Name" htmlFor="inv-name">
            <input
              id="inv-name"
              type="text"
              required
              maxLength={100}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field
            label="Symbol"
            htmlFor="inv-symbol"
            hint="Used for live pricing on stock and crypto."
          >
            <input
              id="inv-symbol"
              type="text"
              value={form.symbol}
              onChange={(e) => setForm({ ...form, symbol: e.target.value })}
              className={inputClass}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity" htmlFor="inv-qty">
              <input
                id="inv-qty"
                type="number"
                step="any"
                min="0.0001"
                max="999999999.99"
                required
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="Buy price" htmlFor="inv-buy">
              <input
                id="inv-buy"
                type="number"
                step="0.01"
                min="0.01"
                max="999999999.99"
                required
                value={form.buyPrice}
                onChange={(e) => setForm({ ...form, buyPrice: e.target.value })}
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Current price (optional)" htmlFor="inv-current">
            <input
              id="inv-current"
              type="number"
              step="0.01"
              min="0"
              value={form.currentPrice}
              onChange={(e) => setForm({ ...form, currentPrice: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Buy date" htmlFor="inv-date">
            <input
              id="inv-date"
              type="date"
              value={form.buyDate}
              onChange={(e) => setForm({ ...form, buyDate: e.target.value })}
              className={inputClass}
            />
          </Field>
        </form>
      </Modal>
    </section>
    </Skeleton>
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
      <div className={`mt-2 text-2xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}
