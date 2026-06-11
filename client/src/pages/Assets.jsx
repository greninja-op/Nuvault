import { useEffect, useState } from 'react';
import apiClient from '../api/client';
import Field, { inputClass } from '../components/Field';
import Modal from '../components/Modal';
import { useDisplayCurrency } from '../currency/CurrencyContext';
import { extractError, formatCurrency } from '../lib/format';

const ASSET_TYPES = [
  'cash',
  'bank',
  'stock',
  'crypto',
  'mutual_fund',
  'fd',
  'real_estate',
  'other',
];

const EMPTY_FORM = { name: '', type: 'cash', value: '', currency: 'INR', notes: '' };

/**
 * Assets list with create/edit/delete via a modal form. Backend endpoints:
 *   GET/POST/PUT/DELETE /assets — see assetController.
 */
export default function Assets() {
  const { displayCurrency, format } = useDisplayCurrency();
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
      const { data } = await apiClient.get('/assets');
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(extractError(err, 'Unable to load assets'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, currency: displayCurrency });
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(asset) {
    setEditing(asset);
    setForm({
      name: asset.name ?? '',
      type: asset.type ?? 'cash',
      value: String(asset.value ?? ''),
      currency: asset.currency ?? 'INR',
      notes: asset.notes ?? '',
    });
    setFormError(null);
    setModalOpen(true);
  }

  function validate() {
    if (!form.name.trim()) return 'Name is required.';
    if (form.name.length > 100) return 'Name must be 1 to 100 characters.';
    if (!ASSET_TYPES.includes(form.type)) return 'Type is invalid.';
    const num = Number(form.value);
    if (!Number.isFinite(num)) return 'Value must be a number.';
    if (num < 0.01 || num > 999999999.99) {
      return 'Value must be between 0.01 and 999,999,999.99.';
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
        value: Number(form.value),
        currency: form.currency || 'INR',
        notes: form.notes,
      };
      if (editing) {
        await apiClient.put(`/assets/${editing._id}`, payload);
      } else {
        await apiClient.post('/assets', payload);
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(extractError(err, 'Unable to save asset'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(asset) {
    if (typeof window !== 'undefined' && !window.confirm(`Delete ${asset.name}?`)) {
      return;
    }
    try {
      await apiClient.delete(`/assets/${asset._id}`);
      await load();
    } catch (err) {
      setError(extractError(err, 'Unable to delete asset'));
    }
  }

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Assets</h1>
          <p className="text-sm text-slate-600">Things you own.</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="flex min-h-[44px] shrink-0 items-center justify-center rounded-md bg-indigo-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
        >
          New asset
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
        <p className="text-sm text-slate-500">No assets yet. Click "New asset" to add one.</p>
      ) : (
        <>
          {/* Desktop / tablet: table */}
          <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm md:block">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <Th>Name</Th>
                  <Th>Type</Th>
                  <Th align="right">Value</Th>
                  <Th>Currency</Th>
                  <Th align="right">Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {items.map((asset) => (
                  <tr key={asset._id}>
                    <Td>{asset.name}</Td>
                    <Td className="text-slate-600">{asset.type}</Td>
                    <Td align="right">{format(asset.value)}</Td>
                    <Td className="text-slate-600">{asset.currency || 'INR'}</Td>
                    <Td align="right">
                      <RowActions onEdit={() => openEdit(asset)} onDelete={() => handleDelete(asset)} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: card list */}
          <ul className="space-y-3 md:hidden">
            {items.map((asset) => (
              <li
                key={asset._id}
                className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-900">{asset.name}</div>
                    <div className="text-xs text-slate-500">{asset.type}</div>
                  </div>
                  <div className="shrink-0 text-right text-base font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                    {format(asset.value)}
                    <div className="text-xs font-normal text-slate-500">
                      {asset.currency || 'INR'}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex gap-2 border-t border-slate-100 pt-2">
                  <button
                    type="button"
                    onClick={() => openEdit(asset)}
                    className="flex min-h-[44px] flex-1 items-center justify-center rounded-md border border-slate-300 text-sm font-medium text-indigo-600 hover:bg-slate-50"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(asset)}
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
        title={editing ? 'Edit asset' : 'New asset'}
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
              form="asset-form"
              disabled={submitting}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:bg-indigo-400"
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        <form id="asset-form" onSubmit={handleSubmit} className="space-y-3">
          {formError && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError}
            </p>
          )}
          <Field label="Name" htmlFor="asset-name">
            <input
              id="asset-name"
              type="text"
              required
              maxLength={100}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Type" htmlFor="asset-type">
            <select
              id="asset-type"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              className={inputClass}
            >
              {ASSET_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Value" htmlFor="asset-value" hint="0.01 to 999,999,999.99">
            <input
              id="asset-value"
              type="number"
              step="0.01"
              min="0.01"
              max="999999999.99"
              required
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Currency" htmlFor="asset-currency">
            <input
              id="asset-currency"
              type="text"
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
              className={inputClass}
            />
          </Field>
          <Field label="Notes" htmlFor="asset-notes">
            <textarea
              id="asset-notes"
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

function Th({ children, align = 'left' }) {
  return (
    <th className={`px-4 py-2 text-${align} text-xs font-medium uppercase tracking-wide text-slate-500`}>
      {children}
    </th>
  );
}

function Td({ children, align = 'left', className = '' }) {
  return <td className={`px-4 py-2 text-${align} ${className}`}>{children}</td>;
}

function RowActions({ onEdit, onDelete }) {
  return (
    <div className="flex justify-end gap-2">
      <button
        type="button"
        onClick={onEdit}
        className="text-xs font-medium text-indigo-600 hover:underline"
      >
        Edit
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="text-xs font-medium text-red-600 hover:underline"
      >
        Delete
      </button>
    </div>
  );
}
