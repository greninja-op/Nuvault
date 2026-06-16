import { useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  CreditCard,
  Home,
  Pencil,
  Phone,
  Plus,
  Receipt,
  Repeat,
  Shield,
  Trash2,
  Tv,
  Wifi,
  Zap,
} from 'lucide-react';
import apiClient from '../api/client';
import { useDisplayCurrency } from '../currency/CurrencyContext';
import { extractError } from '../lib/format';
import { sanitizeInput } from '../utils/sanitize';
import BillsSkeleton from '../components/skeletons/BillsSkeleton';
import useWindowSize from '../hooks/useWindowSize';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Toggle from '../components/ui/Toggle';
import Modal from '../components/ui/Modal';

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

/** Whole days from today until `dueDate` (negative = overdue). */
function daysUntil(dueDate) {
  if (!dueDate) return Number.POSITIVE_INFINITY;
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return Number.POSITIVE_INFINITY;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(due);
  d.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86400000);
}

function shortDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** Human-friendly recurring frequency label. */
function freqLabel(frequency) {
  const map = { monthly: 'Monthly', weekly: 'Weekly', yearly: 'Yearly', 'one-time': 'One-time' };
  return map[frequency] ?? frequency;
}

/** Map a bill's category/name to an icon + accent color. */
function billVisual(category, name) {
  const c = `${category || ''} ${name || ''}`.toLowerCase();
  if (c.includes('rent') || c.includes('housing') || c.includes('home') || c.includes('mortgage'))
    return { Icon: Home, color: '#06b6d4' };
  if (c.includes('electric') || c.includes('power') || c.includes('energy'))
    return { Icon: Zap, color: '#f59e0b' };
  if (c.includes('internet') || c.includes('wifi') || c.includes('broadband'))
    return { Icon: Wifi, color: '#7c6ee8' };
  if (c.includes('phone') || c.includes('mobile'))
    return { Icon: Phone, color: '#a78bfa' };
  if (
    c.includes('stream') || c.includes('netflix') || c.includes('ott') ||
    c.includes('prime') || c.includes('spotify') || c.includes('hotstar')
  )
    return { Icon: Tv, color: '#ef4444' };
  if (c.includes('insurance')) return { Icon: Shield, color: '#22c55e' };
  if (c.includes('subscription') || c.includes('sub')) return { Icon: CreditCard, color: '#f59e0b' };
  return { Icon: Receipt, color: '#a1a1aa' };
}

/**
 * Bills list grouped into Overdue / Upcoming / Paid, with create/edit/delete
 * and a "Pay" action (`PATCH /bills/:id/pay`). The backend advances recurring
 * bills and settles one-time bills; the client just re-fetches.
 *
 * Backend endpoints (unchanged):
 *   GET    /bills
 *   POST   /bills
 *   PUT    /bills/:id
 *   DELETE /bills/:id
 *   PATCH  /bills/:id/pay
 */
export default function Bills() {
  const { format } = useDisplayCurrency();
  const { isMobile } = useWindowSize();
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
        name: sanitizeInput(form.name.trim()),
        amount: Number(form.amount),
        frequency: form.frequency,
        nextDueDate: form.nextDueDate,
        category: sanitizeInput(form.category),
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
    if (!bill || deleting) return;
    setDeleting(true);
    try {
      await apiClient.delete(`/bills/${bill._id}`);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(extractError(err, 'Unable to delete bill'));
    } finally {
      setDeleting(false);
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

  // Group: paid → paid; unpaid past due → overdue; else upcoming.
  const groups = { overdue: [], upcoming: [], paid: [] };
  for (const bill of items) {
    if (bill.isPaid) groups.paid.push(bill);
    else if (daysUntil(bill.nextDueDate) < 0) groups.overdue.push(bill);
    else groups.upcoming.push(bill);
  }
  groups.upcoming.sort((a, b) => new Date(a.nextDueDate) - new Date(b.nextDueDate));

  const dueThisMonth = [...groups.overdue, ...groups.upcoming].reduce(
    (s, b) => s + (Number(b.amount) || 0),
    0,
  );
  const paidThisMonth = groups.paid.reduce((s, b) => s + (Number(b.amount) || 0), 0);

  const SECTIONS = [
    { key: 'overdue', label: 'Overdue', icon: AlertCircle, color: 'var(--red)', muted: 'var(--red-muted)', labelColor: 'var(--red)', badge: 'danger' },
    { key: 'upcoming', label: 'Upcoming', icon: Clock, color: 'var(--amber)', muted: 'var(--amber-muted)', labelColor: 'var(--text-primary)', badge: 'default' },
    { key: 'paid', label: 'Paid', icon: CheckCircle2, color: 'var(--green)', muted: 'var(--green-muted)', labelColor: 'var(--text-secondary)', badge: 'success' },
  ];

  if (loading) return <BillsSkeleton />;

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
        }}
      >
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
            Bills
          </h1>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 4 }}>
            Never miss a due date again.
          </p>
        </div>
        <Button variant="primary" onClick={openCreate}>
          <Plus size={16} strokeWidth={2} />
          New bill
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
          {/* Summary strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
            <SummaryChip label="Due This Month" value={format(dueThisMonth)} color="var(--text-primary)" />
            <SummaryChip
              label="Overdue"
              value={String(groups.overdue.length)}
              color={groups.overdue.length > 0 ? 'var(--red)' : 'var(--text-muted)'}
            />
            <SummaryChip label="Paid This Month" value={format(paidThisMonth)} color="var(--green)" />
          </div>

          {/* Sections */}
          {SECTIONS.map((section, sIdx) => {
            const group = groups[section.key];
            if (group.length === 0) return null;
            const Icon = section.icon;
            return (
              <div key={section.key}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginTop: sIdx === 0 ? 0 : 24,
                    marginBottom: 12,
                  }}
                >
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: section.muted,
                      color: section.color,
                      flexShrink: 0,
                    }}
                  >
                    <Icon size={12} strokeWidth={2.25} />
                  </span>
                  <span style={{ fontSize: 15, fontWeight: 600, color: section.labelColor }}>
                    {section.label}
                  </span>
                  <Badge variant={section.badge}>{group.length}</Badge>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {group.map((bill) => (
                    <BillCard
                      key={bill._id}
                      bill={bill}
                      status={section.key}
                      isMobile={isMobile}
                      format={format}
                      onPay={() => handlePay(bill)}
                      onEdit={() => openEdit(bill)}
                      onDelete={() => setDeleteTarget(bill)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* Add / Edit modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Bill' : 'Add Bill'}>
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
            label="Bill Name"
            type="text"
            required
            maxLength={100}
            placeholder="e.g. Netflix, Rent"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Input
            label="Amount"
            prefix="₹"
            type="number"
            step="0.01"
            min="0.01"
            max="999999999.99"
            required
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
          />
          <Input
            label="Category"
            type="text"
            placeholder="e.g. Streaming, Housing"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <StyledSelect
              label="Frequency"
              value={form.frequency}
              onChange={(e) => setForm({ ...form, frequency: e.target.value })}
              options={FREQUENCIES}
            />
            <Input
              label="Next Due Date"
              type="date"
              required
              value={form.nextDueDate}
              onChange={(e) => setForm({ ...form, nextDueDate: e.target.value })}
            />
          </div>
          <Toggle
            label="Auto Pay"
            checked={form.autoPay}
            onChange={(checked) => setForm({ ...form, autoPay: checked })}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" loading={submitting}>
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
            Delete this bill?
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>This action cannot be undone.</div>
          <div style={{ display: 'flex', gap: 10, marginTop: 16, width: '100%' }}>
            <Button variant="secondary" fullWidth onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" fullWidth loading={deleting} onClick={() => handleDelete(deleteTarget)}>
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ── Presentational helpers ────────────────────────────────────────────────*/

function BillCard({ bill, status, isMobile, format, onPay, onEdit, onDelete }) {
  const [hover, setHover] = useState(false);
  const { Icon, color } = billVisual(bill.category, bill.name);
  const days = daysUntil(bill.nextDueDate);

  const accent =
    status === 'paid'
      ? 'var(--green)'
      : status === 'overdue'
        ? 'var(--red)'
        : days <= 3
          ? 'var(--amber)'
          : 'var(--accent)';

  let dueText;
  let dueColor;
  if (status === 'paid') {
    dueText = `Paid ${shortDate(bill.nextDueDate)}`;
    dueColor = 'var(--green)';
  } else if (status === 'overdue') {
    dueText = `Was due ${shortDate(bill.nextDueDate)}`;
    dueColor = 'var(--red)';
  } else {
    dueText = `Due ${shortDate(bill.nextDueDate)}`;
    dueColor = 'var(--text-muted)';
  }

  // Status badge + pay control (button text kept as "Pay" across statuses).
  let badge = null;
  if (status === 'paid') badge = <Badge variant="success">Paid</Badge>;
  else if (status === 'overdue') badge = <Badge variant="danger">Overdue</Badge>;
  else {
    const label = days === 0 ? 'Today' : `${days} day${days === 1 ? '' : 's'}`;
    badge = <Badge variant={days <= 7 ? 'warning' : 'default'}>{label}</Badge>;
  }
  const payVariant = status === 'upcoming' && days > 7 ? 'secondary' : 'primary';
  const iconSize = isMobile ? 36 : 40;

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: isMobile ? '14px 16px' : '16px 20px',
        paddingLeft: isMobile ? 18 : 22,
        boxShadow: hover ? 'var(--shadow-md)' : 'var(--shadow-sm)',
        transition: 'box-shadow 200ms var(--ease)',
        display: 'flex',
        alignItems: 'center',
        gap: isMobile ? 12 : 16,
      }}
    >
      {/* Left accent */}
      <span
        aria-hidden="true"
        style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: accent }}
      />

      {/* Category icon */}
      <span
        style={{
          width: iconSize,
          height: iconSize,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: `color-mix(in srgb, ${color} 12%, transparent)`,
          color,
          flexShrink: 0,
        }}
      >
        <Icon size={20} strokeWidth={1.75} />
      </span>

      {/* Middle */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: status === 'paid' ? 'var(--text-secondary)' : 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {bill.name}
          </span>
          {bill.frequency && bill.frequency !== 'one-time' && (
            <span
              title={freqLabel(bill.frequency)}
              aria-label={freqLabel(bill.frequency)}
              style={{ display: 'inline-flex', alignItems: 'center', color: 'var(--text-muted)', flexShrink: 0 }}
            >
              <Repeat size={13} strokeWidth={1.75} />
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
          {bill.category && (
            <span
              style={{
                fontSize: 12,
                fontWeight: 500,
                color,
                background: `color-mix(in srgb, ${color} 12%, transparent)`,
                borderRadius: 'var(--radius-full)',
                padding: '2px 8px',
              }}
            >
              {bill.category}
            </span>
          )}
          <span style={{ fontSize: 12, color: dueColor }}>{dueText}</span>
        </div>
      </div>

      {/* Right */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: isMobile ? 15 : 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
          {format(bill.amount)}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {badge}
          {status !== 'paid' && (
            <Button variant={payVariant} size="sm" onClick={onPay}>
              <CheckCircle2 size={14} strokeWidth={2} />
              Pay
            </Button>
          )}
        </div>
      </div>

      {/* Edit / delete */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
        <IconBtn icon={Pencil} label="Edit" onClick={onEdit} />
        <IconBtn icon={Trash2} label="Delete" danger onClick={onDelete} />
      </div>
    </div>
  );
}

function SummaryChip({ label, value, color }) {
  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: 16,
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 500,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--text-muted)',
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color, marginTop: 4 }}>
        {value}
      </div>
    </div>
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
          textTransform: 'capitalize',
        }}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

function IconBtn({ icon: Icon, onClick, danger, label }) {
  const [hover, setHover] = useState(false);
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
        width: 28,
        height: 28,
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
      <Receipt size={48} strokeWidth={1.5} color="var(--text-muted)" />
      <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginTop: 12 }}>
        No bills yet
      </div>
      <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 6 }}>
        Add your recurring bills and subscriptions to stay on top of due dates.
      </div>
      <div style={{ marginTop: 16 }}>
        <Button variant="primary" onClick={onAdd}>
          <Plus size={16} strokeWidth={2} />
          New bill
        </Button>
      </div>
    </div>
  );
}
