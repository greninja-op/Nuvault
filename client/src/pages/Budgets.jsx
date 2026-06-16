import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Car,
  ChevronLeft,
  ChevronRight,
  Heart,
  Music,
  Pencil,
  PieChart as PieChartIcon,
  Plus,
  ShoppingBag,
  Tag,
  Trash2,
  UtensilsCrossed,
} from 'lucide-react';
import apiClient from '../api/client';
import { useDisplayCurrency } from '../currency/CurrencyContext';
import { extractError } from '../lib/format';
import { sanitizeInput } from '../utils/sanitize';
import BudgetSkeleton from '../components/skeletons/BudgetSkeleton';
import DonutChart from '../components/charts/DonutChart';
import useWindowSize from '../hooks/useWindowSize';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const MONTH_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const EMPTY_FORM = { category: '', limit: '', month: 1, year: new Date().getFullYear() };

/** Map a category to an icon + accent color. */
function categoryVisual(category) {
  const c = String(category || '').toLowerCase();
  if (c.includes('food') || c.includes('grocery') || c.includes('groceries') || c.includes('restaurant'))
    return { Icon: UtensilsCrossed, color: '#f59e0b' };
  if (c.includes('transport') || c.includes('fuel') || c.includes('travel') || c.includes('car'))
    return { Icon: Car, color: '#06b6d4' };
  if (c.includes('shop') || c.includes('cloth')) return { Icon: ShoppingBag, color: '#a78bfa' };
  if (c.includes('health') || c.includes('medical')) return { Icon: Heart, color: '#ef4444' };
  if (c.includes('entertain') || c.includes('music') || c.includes('movie'))
    return { Icon: Music, color: '#f59e0b' };
  return { Icon: Tag, color: '#a1a1aa' };
}

/**
 * Budgets list with month/year navigation and create/edit/delete via a modal.
 * Each card shows the limit, computed `spent`, `remaining`, and `overBudget`.
 *
 * Backend endpoints (unchanged):
 *   GET    /budgets?month=&year=
 *   POST   /budgets
 *   PUT    /budgets/:id
 *   DELETE /budgets/:id
 */
export default function Budgets() {
  const { format } = useDisplayCurrency();
  const { width, isMobile } = useWindowSize();
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

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

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

  async function confirmDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await apiClient.delete(`/budgets/${deleteTarget._id}`);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(extractError(err, 'Unable to delete budget'));
    } finally {
      setDeleting(false);
    }
  }

  function prevMonth() {
    if (month === 1) {
      setMonth(12);
      setYear((y) => y - 1);
    } else {
      setMonth((m) => m - 1);
    }
  }
  function nextMonth() {
    if (month === 12) {
      setMonth(1);
      setYear((y) => y + 1);
    } else {
      setMonth((m) => m + 1);
    }
  }

  const totalBudget = items.reduce((s, b) => s + (Number(b.limit) || 0), 0);
  const totalSpent = items.reduce((s, b) => s + (Number(b.spent) || 0), 0);
  const remaining = totalBudget - totalSpent;

  const spendData = items
    .filter((b) => Number(b.spent) > 0)
    .map((b) => ({ name: b.category, value: Number(b.spent), amount: Number(b.spent) }));

  const columns = width >= 1024 ? 3 : width >= 768 ? 2 : 1;

  if (loading) return <BudgetSkeleton />;

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
            Budget
          </h1>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 4 }}>
            Set limits, track spending, stay on course.
          </p>
        </div>
        <Button variant="primary" onClick={openCreate}>
          <Plus size={16} strokeWidth={2} />
          Add Budget
        </Button>
      </div>

      {/* Month navigator */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 24 }}>
        <IconBtn icon={ChevronLeft} label="Previous month" onClick={prevMonth} size={36} />
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', minWidth: 120, textAlign: 'center' }}>
          {MONTH_FULL[month - 1]} {year}
        </span>
        <IconBtn icon={ChevronRight} label="Next month" onClick={nextMonth} size={36} />
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
            <SummaryChip label="Total Budget" value={format(totalBudget)} color="var(--text-primary)" />
            <SummaryChip label="Total Spent" value={format(totalSpent)} color="var(--red)" />
            <SummaryChip label="Remaining" value={format(remaining)} color={remaining > 0 ? 'var(--green)' : 'var(--red)'} />
          </div>

          {/* Spending donut */}
          {spendData.length >= 2 && totalSpent > 0 && (
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
              <div style={{ marginBottom: 16 }}>
                <div className="text-subhead" style={{ color: 'var(--text-primary)' }}>
                  Spending Breakdown
                </div>
                <div className="text-caption">This month</div>
              </div>
              <DonutChart
                data={spendData}
                height={isMobile ? 200 : 240}
                centerValue={format(totalSpent)}
                centerLabel="Spent"
                valueFormatter={(n) => format(n)}
              />
            </div>
          )}

          {/* Budget cards grid */}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: 16 }}>
            {items.map((budget) => (
              <BudgetCard
                key={budget._id}
                budget={budget}
                format={format}
                onEdit={() => openEdit(budget)}
                onDelete={() => setDeleteTarget(budget)}
              />
            ))}
          </div>
        </>
      )}

      {/* Add / Edit modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Budget' : 'Add Budget'}>
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
            label="Category"
            type="text"
            required
            maxLength={100}
            placeholder="e.g. Food, Transport"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          />
          <Input
            label="Monthly Limit"
            prefix="₹"
            type="number"
            step="0.01"
            min="0.01"
            max="999999999.99"
            required
            value={form.limit}
            onChange={(e) => setForm({ ...form, limit: e.target.value })}
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
            Delete this budget?
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

function BudgetCard({ budget, format, onEdit, onDelete }) {
  const limit = Number(budget.limit) || 0;
  const spent = Number(budget.spent) || 0;
  const ratio = limit > 0 ? spent / limit : 0;
  const pct = Math.round(ratio * 100);
  const over = budget.overBudget || spent > limit;
  const { Icon, color } = categoryVisual(budget.category);

  const fillColor = ratio > 0.9 ? 'var(--red)' : ratio >= 0.7 ? 'var(--amber)' : 'var(--green)';

  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: `1px solid ${over ? 'var(--red-muted)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-lg)',
        padding: 20,
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      {/* Top row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
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
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {budget.category}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
          <IconBtn icon={Pencil} label="Edit" onClick={onEdit} size={28} />
          <IconBtn icon={Trash2} label="Delete" danger onClick={onDelete} size={28} />
        </div>
      </div>

      {/* Amount row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '12px 0 8px', gap: 8 }}>
        <span
          style={{
            fontSize: 20,
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            color: over ? 'var(--red)' : 'var(--text-primary)',
          }}
        >
          {format(spent)}
        </span>
        <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          of {format(limit)}
        </span>
      </div>

      {/* Progress bar */}
      <div style={{ height: 8, borderRadius: 'var(--radius-full)', background: 'var(--bg-elevated)', overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${Math.min(pct, 100)}%`,
            background: fillColor,
            borderRadius: 'var(--radius-full)',
            transition: 'width 400ms var(--ease)',
          }}
        />
      </div>

      {/* Bottom row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: fillColor }}>{pct}% used</span>
        {over ? (
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--red)' }}>
            {format(spent - limit)} over
          </span>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {format(Math.max(limit - spent, 0))} left
          </span>
        )}
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

function IconBtn({ icon: Icon, onClick, danger, label, size = 32 }) {
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
      <Icon size={size >= 36 ? 20 : 16} strokeWidth={1.75} />
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
      <PieChartIcon size={48} strokeWidth={1.5} color="var(--text-muted)" />
      <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginTop: 12 }}>
        No budgets set
      </div>
      <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 6 }}>
        Create your first budget to start tracking spending limits.
      </div>
      <div style={{ marginTop: 16 }}>
        <Button variant="primary" onClick={onAdd}>
          <Plus size={16} strokeWidth={2} />
          Add Budget
        </Button>
      </div>
    </div>
  );
}
