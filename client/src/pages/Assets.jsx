import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BarChart2,
  Bitcoin,
  Home,
  Landmark,
  Package,
  Pencil,
  PiggyBank,
  Plus,
  TrendingUp,
  Trash2,
  Wallet,
} from 'lucide-react';
import apiClient from '../api/client';
import { useDisplayCurrency } from '../currency/CurrencyContext';
import { extractError } from '../lib/format';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';

const ASSET_TYPES = ['cash', 'bank', 'stock', 'crypto', 'mutual_fund', 'fd', 'real_estate', 'other'];

const TYPE_META = {
  cash: { Icon: Wallet, color: '#16a34a', label: 'Cash' },
  bank: { Icon: Landmark, color: '#06b6d4', label: 'Bank' },
  stock: { Icon: BarChart2, color: '#f59e0b', label: 'Stock' },
  crypto: { Icon: Bitcoin, color: '#f59e0b', label: 'Crypto' },
  mutual_fund: { Icon: TrendingUp, color: '#22c55e', label: 'Mutual Fund' },
  fd: { Icon: PiggyBank, color: '#06b6d4', label: 'Fixed Deposit' },
  real_estate: { Icon: Home, color: '#ef4444', label: 'Real Estate' },
  other: { Icon: Package, color: '#a1a1aa', label: 'Other' },
};

function typeMeta(type) {
  return TYPE_META[type] ?? { Icon: Package, color: '#a1a1aa', label: type || 'Other' };
}

const EMPTY_FORM = { name: '', type: 'cash', value: '', currency: 'INR', notes: '' };

/**
 * Assets list with create/edit/delete via a modal form.
 * Backend endpoints (unchanged): GET/POST/PUT/DELETE /assets.
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

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

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

  async function confirmDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await apiClient.delete(`/assets/${deleteTarget._id}`);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(extractError(err, 'Unable to delete asset'));
    } finally {
      setDeleting(false);
    }
  }

  const totalValue = items.reduce((s, a) => s + (Number(a.value) || 0), 0);

  if (loading) {
    return (
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading…</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          marginBottom: 24,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
            Assets
          </h1>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 4 }}>
            Everything you own, all in one place.
          </p>
        </div>
        <Button variant="primary" onClick={openCreate}>
          <Plus size={16} strokeWidth={2} />
          New asset
        </Button>
      </div>

      {error && (
        <p
          role="alert"
          style={{
            background: 'var(--red-muted)',
            color: 'var(--red)',
            borderRadius: 'var(--radius-md)',
            padding: '8px 12px',
            fontSize: 13,
            marginBottom: 20,
          }}
        >
          {error}
        </p>
      )}

      {items.length === 0 ? (
        <EmptyState onAdd={openCreate} />
      ) : (
        <>
          {/* Summary card */}
          <div
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              padding: 20,
              boxShadow: 'var(--shadow-sm)',
              marginBottom: 24,
            }}
          >
            <div className="text-label">Total Assets</div>
            <div style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--green)', marginTop: 6 }}>
              {format(totalValue)}
            </div>
            <div className="text-caption" style={{ marginTop: 2 }}>
              {items.length} asset{items.length === 1 ? '' : 's'} tracked
            </div>
          </div>

          {/* Desktop table */}
          <div
            className="hidden md:block"
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <Th>Asset</Th>
                  <Th>Type</Th>
                  <Th align="right">Value</Th>
                  <Th align="right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((asset, idx) => {
                  const meta = typeMeta(asset.type);
                  return (
                    <tr
                      key={asset._id}
                      className="tx-row"
                      style={{ borderBottom: idx === items.length - 1 ? 'none' : '1px solid var(--border-subtle)' }}
                    >
                      <Td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <TypeIcon meta={meta} />
                          <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>
                            {asset.name}
                          </span>
                        </div>
                      </Td>
                      <Td>
                        <Badge variant="default">{meta.label}</Badge>
                      </Td>
                      <Td align="right" style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--green)' }}>
                        {format(asset.value)}
                      </Td>
                      <Td align="right">
                        <span className="tx-actions" style={{ display: 'inline-flex', gap: 4 }}>
                          <IconBtn icon={Pencil} label="Edit" small onClick={() => openEdit(asset)} />
                          <IconBtn icon={Trash2} label="Delete" small danger onClick={() => setDeleteTarget(asset)} />
                        </span>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((asset) => {
              const meta = typeMeta(asset.type);
              return (
                <div
                  key={asset._id}
                  style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border)',
                    borderLeft: `4px solid ${meta.color}`,
                    borderRadius: 'var(--radius-lg)',
                    padding: '14px 16px',
                    boxShadow: 'var(--shadow-sm)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <TypeIcon meta={meta} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 500,
                        color: 'var(--text-primary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {asset.name}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{meta.label}</div>
                  </div>
                  <span style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--green)', whiteSpace: 'nowrap' }}>
                    {format(asset.value)}
                  </span>
                  <IconBtn icon={Pencil} label="Edit" small onClick={() => openEdit(asset)} />
                  <IconBtn icon={Trash2} label="Delete" small danger onClick={() => setDeleteTarget(asset)} />
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Add / Edit modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Asset' : 'New Asset'}>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {formError && (
            <p
              role="alert"
              style={{
                background: 'var(--red-muted)',
                color: 'var(--red)',
                borderRadius: 'var(--radius-md)',
                padding: '8px 12px',
                fontSize: 13,
              }}
            >
              {formError}
            </p>
          )}
          <Input
            label="Name"
            type="text"
            required
            maxLength={100}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <StyledSelect
            label="Type"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            options={ASSET_TYPES.map((t) => ({ value: t, label: typeMeta(t).label }))}
          />
          <Input
            label="Value"
            prefix="₹"
            type="number"
            step="0.01"
            min="0.01"
            max="999999999.99"
            required
            value={form.value}
            onChange={(e) => setForm({ ...form, value: e.target.value })}
          />
          <Input
            label="Currency"
            type="text"
            value={form.currency}
            onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
          />
          <Input
            label="Notes"
            type="text"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <Button variant="ghost" fullWidth onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" fullWidth type="submit" loading={submitting}>
              Save
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete confirmation */}
      <Modal open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} title="" maxWidth={360}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 6 }}>
          <AlertTriangle size={40} strokeWidth={1.75} color="var(--red)" />
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginTop: 6 }}>
            Delete this asset?
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>This action cannot be undone.</div>
          <div style={{ display: 'flex', gap: 10, marginTop: 16, width: '100%' }}>
            <Button variant="secondary" fullWidth onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" fullWidth loading={deleting} onClick={confirmDelete}>
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ── Presentational helpers ────────────────────────────────────────────────*/

function TypeIcon({ meta }) {
  const { Icon, color } = meta;
  return (
    <span
      style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        color,
        flexShrink: 0,
      }}
    >
      <Icon size={16} strokeWidth={1.75} />
    </span>
  );
}

function StyledSelect({ label, value, onChange, options }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>{label}</label>
      <select
        value={value}
        onChange={onChange}
        style={{
          width: '100%',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          padding: '11px 14px',
          fontFamily: 'Poppins, system-ui, sans-serif',
          fontSize: 14,
          color: 'var(--text-primary)',
          outline: 'none',
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function IconBtn({ icon: Icon, onClick, danger, label, small }) {
  const [hover, setHover] = useState(false);
  const size = small ? 28 : 32;
  const color = danger
    ? hover
      ? 'var(--red)'
      : 'var(--text-muted)'
    : hover
      ? 'var(--text-primary)'
      : 'var(--text-muted)';
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 'var(--radius-md)',
        border: 'none',
        cursor: 'pointer',
        background: hover ? 'var(--bg-hover)' : 'transparent',
        color,
        flexShrink: 0,
        transition: 'all 150ms var(--ease)',
      }}
    >
      <Icon size={15} strokeWidth={1.75} />
    </button>
  );
}

function Th({ children, align = 'left' }) {
  return (
    <th
      style={{
        fontSize: 11,
        fontWeight: 500,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: 'var(--text-muted)',
        padding: '12px 16px',
        textAlign: align,
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, align = 'left', style }) {
  return <td style={{ padding: '14px 16px', textAlign: align, ...style }}>{children}</td>;
}

function EmptyState({ onAdd }) {
  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        padding: '60px 20px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
      }}
    >
      <Landmark size={48} strokeWidth={1.5} color="var(--text-muted)" />
      <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginTop: 12 }}>
        No assets tracked
      </div>
      <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 6 }}>
        Add your savings, investments, or property to see your full financial picture.
      </div>
      <div style={{ marginTop: 16 }}>
        <Button variant="primary" onClick={onAdd}>
          <Plus size={16} strokeWidth={2} />
          New asset
        </Button>
      </div>
    </div>
  );
}
