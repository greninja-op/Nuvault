import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Banknote,
  Car,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Heart,
  Music,
  Pencil,
  Plus,
  Search,
  ShoppingBag,
  Tag,
  Trash2,
  UtensilsCrossed,
  Wallet,
} from 'lucide-react';
import apiClient from '../api/client';
import { useDisplayCurrency } from '../currency/CurrencyContext';
import { extractError } from '../lib/format';
import { sanitizeInput } from '../utils/sanitize';
import TransactionsSkeleton from '../components/skeletons/TransactionsSkeleton';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import StatCard from '../components/ui/StatCard';

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
  if (!c) return { Icon: Tag, color: '#a1a1aa' };
  return { Icon: Circle, color: '#a1a1aa' };
}

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

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

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

  async function confirmDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await apiClient.delete(`/transactions/${deleteTarget._id}`);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(extractError(err, 'Unable to delete transaction'));
    } finally {
      setDeleting(false);
    }
  }

  const totalIncome = summary.income.reduce((s, x) => s + Number(x.total || 0), 0);
  const totalExpense = summary.expense.reduce((s, x) => s + Number(x.total || 0), 0);
  const net = totalIncome - totalExpense;

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

  function clearFilters() {
    setSearch('');
    setActiveFilter('all');
    setVisibleCount(PAGE_SIZE);
  }

  const filtersActive = activeFilter !== 'all' || search.trim() !== '';

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
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
            Transactions
          </h1>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 4 }}>
            Every rupee in and out, tracked in one place.
          </p>
        </div>
        <Button variant="primary" onClick={openCreate}>
          <Plus size={16} strokeWidth={2} />
          Add Transaction
        </Button>
      </div>

      {/* Summary cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16,
          marginBottom: 24,
        }}
      >
        <StatCard
          label="This Month Income"
          value={format(totalIncome)}
          icon={ArrowDownLeft}
          iconColor="var(--green)"
          valueColor="var(--green)"
          trendLabel={`${MONTHS[month - 1]} ${year}`}
        />
        <StatCard
          label="This Month Expenses"
          value={format(totalExpense)}
          icon={ArrowUpRight}
          iconColor="var(--red)"
          valueColor="var(--red)"
          trendLabel={`${MONTHS[month - 1]} ${year}`}
        />
        <StatCard
          label="Net This Month"
          value={`${net >= 0 ? '' : '-'}${format(Math.abs(net))}`}
          icon={Wallet}
          iconColor="var(--accent)"
          valueColor={net >= 0 ? 'var(--text-primary)' : 'var(--red)'}
          trendLabel={`${MONTHS[month - 1]} ${year}`}
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
          <FilterPill key={f.id} active={activeFilter === f.id} onClick={() => { setActiveFilter(f.id); setVisibleCount(PAGE_SIZE); }}>
            {f.label}
          </FilterPill>
        ))}
        {CATEGORY_FILTERS.map((c) => (
          <FilterPill key={c} active={activeFilter === c} onClick={() => { setActiveFilter(c); setVisibleCount(PAGE_SIZE); }}>
            {c}
          </FilterPill>
        ))}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <IconBtn icon={ChevronLeft} label="Previous month" onClick={prevMonth} />
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', minWidth: 64, textAlign: 'center' }}>
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

      {items.length === 0 ? (
        <EmptyState
          title="No transactions yet"
          subtitle="Add your first transaction to start tracking."
          actionLabel="Add Transaction"
          onAction={openCreate}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No transactions match these filters"
          subtitle="Try adjusting your filters."
          actionLabel="Clear filters"
          actionVariant="ghost"
          onAction={clearFilters}
        />
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
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <Th>Category</Th>
                  <Th>Description</Th>
                  <Th>Date</Th>
                  <Th align="right">Amount</Th>
                </tr>
              </thead>
              <tbody>
                {shown.map((tx, idx) => {
                  const { Icon, color } = categoryVisual(tx.category, tx.type);
                  const income = tx.type === 'income';
                  return (
                    <tr
                      key={tx._id}
                      className="tx-row"
                      style={{ borderBottom: idx === shown.length - 1 ? 'none' : '1px solid var(--border-subtle)' }}
                    >
                      <Td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <CategoryIcon Icon={Icon} color={color} />
                          <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>
                            {tx.category}
                          </span>
                        </div>
                      </Td>
                      <Td style={{ fontSize: 14, color: 'var(--text-secondary)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {tx.description || '—'}
                      </Td>
                      <Td style={{ fontSize: 13, color: 'var(--text-muted)' }}>{shortDate(tx.date)}</Td>
                      <Td align="right">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                          <span className="tx-actions" style={{ display: 'inline-flex', gap: 4 }}>
                            <IconBtn icon={Pencil} label="Edit" small onClick={() => openEdit(tx)} />
                            <IconBtn icon={Trash2} label="Delete" small danger onClick={() => setDeleteTarget(tx)} />
                          </span>
                          <span
                            style={{
                              fontSize: 14,
                              fontWeight: 600,
                              fontVariantNumeric: 'tabular-nums',
                              whiteSpace: 'nowrap',
                              color: income ? 'var(--green)' : 'var(--red)',
                            }}
                          >
                            {income ? '+' : '-'}
                            {format(tx.amount)}
                          </span>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {shown.map((tx) => {
              const { Icon, color } = categoryVisual(tx.category, tx.type);
              const income = tx.type === 'income';
              return (
                <div
                  key={tx._id}
                  style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border)',
                    borderLeft: `4px solid ${color}`,
                    borderRadius: 'var(--radius-lg)',
                    padding: '14px 16px',
                    boxShadow: 'var(--shadow-sm)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <CategoryIcon Icon={Icon} color={color} />
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
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                        {tx.category} · {shortDate(tx.date)}
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: 15,
                        fontWeight: 600,
                        fontVariantNumeric: 'tabular-nums',
                        whiteSpace: 'nowrap',
                        color: income ? 'var(--green)' : 'var(--red)',
                      }}
                    >
                      {income ? '+' : '-'}
                      {format(tx.amount)}
                    </div>
                    <IconBtn icon={Pencil} label="Edit" small onClick={() => openEdit(tx)} />
                    <IconBtn icon={Trash2} label="Delete" small danger onClick={() => setDeleteTarget(tx)} />
                  </div>
                </div>
              );
            })}
          </div>

          {filtered.length > shown.length && (
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <Button variant="ghost" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>
                Load more transactions
                <ChevronDown size={16} strokeWidth={2} />
              </Button>
            </div>
          )}
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginTop: 12 }}>
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

          {/* Income / Expense pill toggle */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {TYPES.map((t) => {
              const active = form.type === t;
              const isIncome = t === 'income';
              const activeBg = isIncome ? 'var(--green-muted)' : 'var(--red-muted)';
              const activeColor = isIncome ? 'var(--green)' : 'var(--red)';
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
                    fontWeight: 600,
                    fontFamily: 'Poppins',
                    cursor: 'pointer',
                    border: '1px solid ' + (active ? activeColor : 'var(--border)'),
                    background: active ? activeBg : 'var(--bg-elevated)',
                    color: active ? activeColor : 'var(--text-secondary)',
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

      {/* Delete confirmation */}
      <Modal open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} title="" maxWidth={360}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 6 }}>
          <AlertTriangle size={40} strokeWidth={1.75} color="var(--red)" />
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginTop: 6 }}>
            Delete this transaction?
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

function CategoryIcon({ Icon, color }) {
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
        border: '1px solid ' + (active ? 'var(--accent)' : hover ? 'var(--accent)' : 'var(--border)'),
        background: active ? 'var(--accent)' : 'var(--bg-elevated)',
        color: active ? '#fff' : hover ? 'var(--text-primary)' : 'var(--text-secondary)',
      }}
    >
      {children}
    </button>
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
      <Icon size={small ? 15 : 16} strokeWidth={1.75} />
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

function EmptyState({ title, subtitle, actionLabel, actionVariant = 'primary', onAction }) {
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
      <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginTop: 12 }}>{title}</div>
      <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 6 }}>{subtitle}</div>
      <div style={{ marginTop: 16 }}>
        <Button variant={actionVariant} onClick={onAction}>
          {actionVariant === 'primary' && <Plus size={16} strokeWidth={2} />}
          {actionLabel}
        </Button>
      </div>
    </div>
  );
}
