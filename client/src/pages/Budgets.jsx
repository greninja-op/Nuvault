import { useEffect, useState } from 'react';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Pencil,
  PieChart as PieChartIcon,
  Plus,
  Trash2,
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
import Badge from '../components/ui/Badge';
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

  // Donut data: only categories with spend. Rendered only when ≥2 categories
  // have spending (a single-slice donut is meaningless and would duplicate the
  // lone category label that already appears on its card).
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
        }}
      >
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
            Budget
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
            Track your spending limits
          </p>
        </div>
        <Button variant="primary" onClick={openCreate}>
          <Plus size={16} strokeWidth={2} />
          Add Budget
        </Button>
      </div>

      {/* Month navigator */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          marginBottom: 24,
        }}
      >
        <IconBtn icon={ChevronLeft} label="Previous month" onClick={prevMonth} size={36} />
        <span
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--text-primary)',
            minWidth: 120,
            textAlign: 'center',
          }}
        >
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
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 12,
              marginBottom: 24,
            }}
          >
            <SummaryChip label="Total Budget" value={format(totalBudget)} color="var(--text-primary)" />
            <SummaryChip label="Total Spent" value={format(totalSpent)} color="var(--red)" />
            <SummaryChip
              label="Remaining"
              value={format(remaining)}
              color={remaining > 0 ? 'var(--green)' : 'var(--red)'}
            />
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
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
                  Spending Breakdown
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {MONTH_FULL[month - 1]} {year}
                </div>
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
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${columns}, 1fr)`,
              gap: 16,
            }}
          >
            {items.map((budget) => (
              <BudgetCard
                key={budget._id}
                budget={budget}
                format={format}
                onEdit={() => openEdit(budget)}
                onDelete={() => handleDelete(budget)}
              />
            ))}
          </div>
        </>
      )}

      {/* Add / Edit modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit Budget' : 'Add Budget'}
      >
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
    </div>
  );
}

/* ── Presentational helpers ────────────────────────────────────────────────*/

function BudgetCard({ budget, format, onEdit, onDelete }) {
  const [hover, setHover] = useState(false);
  const limit = Number(budget.limit) || 0;
  const spent = Number(budget.spent) || 0;
  const ratio = limit > 0 ? spent / limit : 0;
  const pct = Math.round(ratio * 100);
  const over = budget.overBudget || spent > limit;

  const spentColor = ratio > 1 ? 'var(--red)' : ratio >= 0.8 ? 'var(--amber)' : 'var(--text-primary)';
  const fillColor = ratio >= 1 ? 'var(--red)' : ratio >= 0.8 ? 'var(--amber)' : 'var(--accent)';
  const badgeVariant = ratio >= 1 ? 'danger' : ratio >= 0.8 ? 'warning' : 'accent';

  const baseShadow = hover ? 'var(--shadow-md)' : 'var(--shadow-sm)';
  const boxShadow = over ? `inset 4px 0 0 var(--red), ${baseShadow}` : baseShadow;

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: 20,
        boxShadow,
        transition: 'box-shadow 200ms var(--ease)',
      }}
    >
      {/* Top row */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {budget.category}
        </span>
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <IconBtn icon={Pencil} label="Edit" onClick={onEdit} />
          <IconBtn icon={Trash2} label="Delete" danger onClick={onDelete} />
        </div>
      </div>

      {/* Amount row */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 10,
          gap: 8,
        }}
      >
        <span style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: spentColor }}>
          {format(spent)}
        </span>
        <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          of {format(limit)}
        </span>
      </div>

      {/* Progress bar */}
      <div
        style={{
          height: 8,
          borderRadius: 'var(--radius-full)',
          background: 'var(--bg-elevated)',
          overflow: 'hidden',
          marginBottom: 12,
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${Math.min(pct, 100)}%`,
            background: fillColor,
            borderRadius: 'var(--radius-full)',
            transition: 'width 700ms var(--ease)',
          }}
        />
      </div>

      {/* Bottom row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        {over ? (
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--red)' }}>
            {format(spent - limit)} over budget
          </span>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {format(Math.max(limit - spent, 0))} left
          </span>
        )}
        <Badge variant={badgeVariant}>{pct}%</Badge>
      </div>

      {/* Over-budget warning */}
      {over && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginTop: 8,
            paddingTop: 8,
            borderTop: '1px solid var(--red-muted)',
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--red)',
          }}
        >
          <AlertCircle size={14} strokeWidth={2} />
          Over budget by {format(spent - limit)}
        </div>
      )}
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
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          color,
          marginTop: 4,
        }}
      >
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
      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)', marginTop: 12 }}>
        No budgets set
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
        Set spending limits to track where your money goes
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
