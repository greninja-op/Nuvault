import { useEffect, useState } from 'react';
import {
  ArrowLeftRight,
  Banknote,
  Car,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Heart,
  Music,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  ShoppingBag,
  Trash2,
  UtensilsCrossed,
} from 'lucide-react';
import apiClient from '../api/client';
import { useDisplayCurrency } from '../currency/CurrencyContext';
import { extractError } from '../lib/format';
import { sanitizeInput } from '../utils/sanitize';
import TransactionsSkeleton from '../components/skeletons/TransactionsSkeleton';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';

const TYPES = ['income', 'expense'];

const EMPTY_FORM = {
  type: 'expense',
  category: '',
  amount: '',
  description: '',
  date: '',
};

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const TYPE_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'income', label: 'Income' },
  { id: 'expense', label: 'Expense' },
];
const CATEGORY_FILTERS = ['Food', 'Transport', 'Shopping', 'Health', 'Entertainment', 'Other'];

const PAGE_SIZE = 20;

/** Map a transaction category/type to an icon + accent color. */
function categoryVisual(category, type) {
  const c = String(category || '').toLowerCase();
  if (type === 'income' || c.includes('salary') || c.includes('income'))
    return { Icon: Banknote, color: '#16a34a' };
  if (c.includes('food') || c.includes('grocery') || c.includes('groceries') || c.includes('restaurant'))
    return { Icon: UtensilsCrossed, color: '#f59e0b' };
  if (c.includes('transport') || c.includes('fuel') || c.includes('travel') || c.includes('car'))
    return { Icon: Car, color: '#06b6d4' };
  if (c.includes('shop') || c.includes('cloth'))
    return { Icon: ShoppingBag, color: '#a78bfa' };
  if (c.includes('health') || c.includes('medical'))
    return { Icon: Heart, color: '#ef4444' };
  if (c.includes('entertain') || c.includes('music') || c.includes('movie'))
    return { Icon: Music, color: '#f59e0b' };
  return { Icon: Circle, color: '#a1a1aa' };
}

/** Short "12 Jun" date. */
function shortDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/**
 * Transactions list with month/year navigation and a category-grouped
 * income/expense summary. Backend endpoints (unchanged):
 *   GET    /transactions?month=&year=
 *   GET    /transactions/summary?month=&year=
 *   POST   /transactions
 *   PUT    /transactions/:id
 *   DELETE /transactions/:id
 */
export default function Transactions() {
  const { format } = useDisplayCurrency();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  // Always filter by the selected month (driven by the chevron navigator).
  const [filterEnabled] = useState(true);

  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({ income: [], expense: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Presentation-only filtering state (no effect on data fetching).
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [menuId, setMenuId] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = filterEnabled ? { month, year } : {};
      const [list, summaryRes] = await Promise.all([
        apiClient.get('/transactions', { params }),
        apiClient.get('/transactions/summary', { params }),
      ]);
      setItems(Array.isArray(list.data) ? list.data : []);
      setSummary({
        income: summaryRes.data?.income ?? [],
        expense: summaryRes.data?.expense ?? [],
      });
    } catch (err) {
      setError(extractError(err, 'Unable to load transactions'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, year, filterEnabled]);

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, date: new Date().toISOString().slice(0, 10) });
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(tx) {
    setEditing(tx);
    setForm({
      type: tx.type ?? 'expense',
      category: tx.category ?? '',
      amount: String(tx.amount ?? ''),
      description: tx.description ?? '',
      date: tx.date ? tx.date.slice(0, 10) : '',
    });
    setFormError(null);
    setModalOpen(true);
  }

  function validate() {
    if (!TYPES.includes(form.type)) return 'Type is invalid.';
    if (!form.category.trim()) return 'Category is required.';
    if (form.category.length > 100) return 'Category must be 1 to 100 characters.';
    const num = Number(form.amount);
    if (!Number.isFinite(num) || num <= 0) return 'Amount must be greater than 0.';
    if (num > 999999999.99) return 'Amount must be at most 999,999,999.99.';
    if (Number(num.toFixed(2)) !== num) return 'Amount must have at most 2 decimal places.';
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
        category: sanitizeInput(form.category.trim()),
        amount: Number(form.amount),
        description: sanitizeInput(form.description),
      };
      if (form.date) payload.date = form.date;

      if (editing) {
        await apiClient.put(`/transactions/${editing._id}`, payload);
      } else {
        await apiClient.post('/transactions', payload);
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(extractError(err, 'Unable to save transaction'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(tx) {
    if (typeof window !== 'undefined' && !window.confirm('Delete this transaction?')) return;
    try {
      await apiClient.delete(`/transactions/${tx._id}`);
      await load();
    } catch (err) {
      setError(extractError(err, 'Unable to delete transaction'));
    }
  }

  const totalIncome = summary.income.reduce((s, x) => s + Number(x.total || 0), 0);
  const totalExpense = summary.expense.reduce((s, x) => s + Number(x.total || 0), 0);
  const balance = totalIncome - totalExpense;

  function prevMonth() {
    setVisibleCount(PAGE_SIZE);
    if (month === 1) {
      setMonth(12);
      setYear((y) => y - 1);
    } else {
      setMonth((m) => m - 1);
    }
  }
  function nextMonth() {
    setVisibleCount(PAGE_SIZE);
    if (month === 12) {
      setMonth(1);
      setYear((y) => y + 1);
    } else {
      setMonth((m) => m + 1);
    }
  }

  // Client-side filtering of the already-fetched month's transactions.
  const filtered = items.filter((tx) => {
    if (activeFilter === 'income' && tx.type !== 'income') return false;
    if (activeFilter === 'expense' && tx.type !== 'expense') return false;
    if (
      CATEGORY_FILTERS.includes(activeFilter) &&
      String(tx.category || '').toLowerCase() !== activeFilter.toLowerCase()
    ) {
      return false;
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      const hay = `${tx.description || ''} ${tx.category || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const shown = filtered.slice(0, visibleCount);

  if (loading) return <TransactionsSkeleton />;

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
            Transactions
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
            Track every rupee in and out
          </p>
        </div>
        <Button variant="primary" onClick={openCreate}>
          <Plus size={16} strokeWidth={2} />
          Add Transaction
        </Button>
      </div>

      {/* Summary strip */}
      <div
        className="no-scrollbar"
        style={{ display: 'flex', gap: 12, marginBottom: 20, overflowX: 'auto' }}
      >
        <SummaryChip label="Income" value={format(totalIncome)} color="var(--green)" />
        <SummaryChip label="Expenses" value={format(totalExpense)} color="var(--red)" />
        <SummaryChip
          label="Balance"
          value={format(balance)}
          color={balance >= 0 ? 'var(--accent)' : 'var(--red)'}
        />
      </div>

      {/* Filter bar */}
      <div
        className="no-scrollbar"
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          marginBottom: 20,
          overflowX: 'auto',
          paddingBottom: 4,
          flexWrap: 'nowrap',
        }}
      >
        <div style={{ flexShrink: 0, width: 240, maxWidth: '60vw' }}>
          <Input
            prefix={<Search size={16} />}
            placeholder="Search transactions..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setVisibleCount(PAGE_SIZE);
            }}
          />
        </div>

        {TYPE_FILTERS.map((f) => (
          <FilterPill
            key={f.id}
            active={activeFilter === f.id}
            onClick={() => {
              setActiveFilter(f.id);
              setVisibleCount(PAGE_SIZE);
            }}
          >
            {f.label}
          </FilterPill>
        ))}
        {CATEGORY_FILTERS.map((c) => (
          <FilterPill
            key={c}
            active={activeFilter === c}
            onClick={() => {
              setActiveFilter(c);
              setVisibleCount(PAGE_SIZE);
            }}
          >
            {c}
          </FilterPill>
        ))}

        {/* Month navigator */}
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexShrink: 0,
          }}
        >
          <IconBtn icon={ChevronLeft} label="Previous month" onClick={prevMonth} />
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap',
              minWidth: 64,
              textAlign: 'center',
            }}
          >
            {MONTHS[month - 1]} {year}
          </span>
          <IconBtn icon={ChevronRight} label="Next month" onClick={nextMonth} />
        </div>
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

      {filtered.length === 0 ? (
        <EmptyState onAdd={openCreate} />
      ) : (
        <>
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
                <tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }}>
                  <Th>Date</Th>
                  <Th>Description</Th>
                  <Th>Category</Th>
                  <Th align="right">Amount</Th>
                  <Th align="right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {shown.map((tx, idx) => {
                  const { color } = categoryVisual(tx.category, tx.type);
                  const income = tx.type === 'income';
                  return (
                    <tr
                      key={tx._id}
                      className="tx-row"
                      style={{
                        borderBottom:
                          idx === shown.length - 1 ? 'none' : '1px solid var(--border-subtle)',
                      }}
                    >
                      <Td style={{ fontSize: 13, color: 'var(--text-muted)' }}>{shortDate(tx.date)}</Td>
                      <Td style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>
                        {tx.description || tx.category}
                      </Td>
                      <Td>
                        <CategoryChip category={tx.category} color={color} />
                      </Td>
                      <Td
                        align="right"
                        style={{
                          fontSize: 14,
                          fontWeight: 600,
                          fontVariantNumeric: 'tabular-nums',
                          color: income ? 'var(--green)' : 'var(--red)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {income ? '+' : '-'}
                        {format(tx.amount)}
                      </Td>
                      <Td align="right">
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
                          <IconBtn icon={Pencil} label="Edit" onClick={() => openEdit(tx)} />
                          <IconBtn icon={Trash2} label="Delete" danger onClick={() => handleDelete(tx)} />
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {shown.map((tx) => {
              const { Icon, color } = categoryVisual(tx.category, tx.type);
              const income = tx.type === 'income';
              return (
                <div
                  key={tx._id}
                  style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border)',
                    borderLeft: `3px solid ${income ? 'var(--green)' : 'var(--red)'}`,
                    borderRadius: 'var(--radius-lg)',
                    padding: '14px 16px',
                    boxShadow: 'var(--shadow-sm)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span
                      style={{
                        width: 36,
                        height: 36,
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
                        {tx.description || tx.category}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                        <span style={{ fontSize: 11, fontWeight: 500, color }}>{tx.category}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {shortDate(tx.date)}
                        </span>
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: 15,
                        fontWeight: 700,
                        fontVariantNumeric: 'tabular-nums',
                        whiteSpace: 'nowrap',
                        color: income ? 'var(--green)' : 'var(--red)',
                      }}
                    >
                      {income ? '+' : '-'}
                      {format(tx.amount)}
                    </div>
                    <IconBtn
                      icon={MoreVertical}
                      label="More"
                      onClick={() => setMenuId(menuId === tx._id ? null : tx._id)}
                    />
                  </div>
                  {menuId === tx._id && (
                    <div
                      style={{
                        display: 'flex',
                        gap: 8,
                        marginTop: 12,
                        paddingTop: 12,
                        borderTop: '1px solid var(--border-subtle)',
                      }}
                    >
                      <Button
                        variant="secondary"
                        size="sm"
                        fullWidth
                        onClick={() => {
                          setMenuId(null);
                          openEdit(tx);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        fullWidth
                        onClick={() => {
                          setMenuId(null);
                          handleDelete(tx);
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Load more + count */}
          {filtered.length > shown.length && (
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <Button variant="ghost" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>
                Load more transactions
                <ChevronDown size={16} strokeWidth={2} />
              </Button>
            </div>
          )}
          <div
            style={{
              fontSize: 12,
              color: 'var(--text-muted)',
              textAlign: 'center',
              marginTop: 12,
            }}
          >
            Showing {shown.length} of {filtered.length} transactions
          </div>
        </>
      )}

      {/* Add / Edit modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit Transaction' : 'Add Transaction'}
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

          {/* Type toggle */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {TYPES.map((t) => {
              const active = form.type === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm({ ...form, type: t })}
                  style={{
                    textTransform: 'capitalize',
                    borderRadius: 'var(--radius-full)',
                    padding: '10px 0',
                    fontSize: 14,
                    fontWeight: 500,
                    fontFamily: 'Poppins',
                    cursor: 'pointer',
                    border: '1px solid ' + (active ? 'var(--accent)' : 'var(--border)'),
                    background: active ? 'var(--accent)' : 'var(--bg-elevated)',
                    color: active ? '#fff' : 'var(--text-secondary)',
                    transition: 'all 150ms var(--ease)',
                  }}
                >
                  {t}
                </button>
              );
            })}
          </div>

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
            required
            maxLength={100}
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          />
          <Input
            label="Description"
            type="text"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <Input
            label="Date"
            type="date"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
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

function SummaryChip({ label, value, color }) {
  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '14px 18px',
        flex: 1,
        flexShrink: 0,
        minWidth: 140,
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
      <div style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color, marginTop: 4 }}>
        {value}
      </div>
    </div>
  );
}

function FilterPill({ active, onClick, children }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        borderRadius: 'var(--radius-full)',
        padding: '7px 16px',
        fontSize: 13,
        fontWeight: 500,
        fontFamily: 'Poppins',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        transition: 'all 150ms var(--ease)',
        border: '1px solid ' + (active ? 'var(--accent)' : 'var(--border)'),
        background: active ? 'var(--accent)' : hover ? 'var(--bg-hover)' : 'var(--bg-surface)',
        color: active ? '#fff' : hover ? 'var(--text-primary)' : 'var(--text-secondary)',
      }}
    >
      {children}
    </button>
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
        width: 32,
        height: 32,
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
      <Icon size={16} strokeWidth={1.75} />
    </button>
  );
}

function CategoryChip({ category, color }) {
  return (
    <span
      style={{
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        color,
        borderRadius: 'var(--radius-full)',
        padding: '3px 10px',
        fontSize: 12,
        fontWeight: 500,
        whiteSpace: 'nowrap',
      }}
    >
      {category}
    </span>
  );
}

function Th({ children, align = 'left' }) {
  return (
    <th
      style={{
        fontSize: 11,
        fontWeight: 500,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
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
      <ArrowLeftRight size={48} strokeWidth={1.5} color="var(--text-muted)" />
      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)', marginTop: 12 }}>
        No transactions found
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
        Try adjusting your filters or add a new transaction
      </div>
      <div style={{ marginTop: 16 }}>
        <Button variant="ghost" onClick={onAdd}>
          <Plus size={16} strokeWidth={2} />
          Add Transaction
        </Button>
      </div>
    </div>
  );
}
