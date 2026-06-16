import { useEffect, useState } from 'react';
import {
  BarChart2,
  DollarSign,
  Pencil,
  Plus,
  Trash2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import apiClient from '../api/client';
import { useDisplayCurrency } from '../currency/CurrencyContext';
import { extractError } from '../lib/format';
import { sanitizeInput } from '../utils/sanitize';
import InvestmentsSkeleton from '../components/skeletons/InvestmentsSkeleton';
import AreaChartCard from '../components/charts/AreaChartCard';
import DonutChart from '../components/charts/DonutChart';
import useSnapshots from '../hooks/useSnapshots';
import useWindowSize from '../hooks/useWindowSize';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';

const TYPES = ['stock', 'crypto', 'mutual_fund', 'fd', 'other'];

const TYPE_META = {
  stock: { label: 'Stock', badge: 'accent' },
  crypto: { label: 'Crypto', badge: 'warning' },
  mutual_fund: { label: 'MF', badge: 'default' },
  fd: { label: 'FD', badge: 'success' },
  other: { label: 'Other', badge: 'default' },
};

const TYPE_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'stock', label: 'Stock' },
  { id: 'crypto', label: 'Crypto' },
  { id: 'mutual_fund', label: 'Mutual Fund' },
  { id: 'fd', label: 'FD' },
  { id: 'other', label: 'Other' },
];

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
 * Investments list with a P&L summary and create/edit/delete via a modal.
 * Backend endpoints (unchanged):
 *   GET    /investments/summary   — items + totals (live priced)
 *   POST   /investments
 *   PUT    /investments/:id
 *   DELETE /investments/:id
 */
export default function Investments() {
  const { format } = useDisplayCurrency();
  const { isMobile } = useWindowSize();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [activeType, setActiveType] = useState('all');

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

  // After the page's own fetch effect so snapshots don't pre-empt it.
  const { snapshots } = useSnapshots();

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
        symbol: sanitizeInput(form.symbol.trim()),
        name: sanitizeInput(form.name.trim()),
        quantity: Number(form.quantity),
        buyPrice: Number(form.buyPrice),
        notes: sanitizeInput(form.notes),
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
  const totalInvested = Number(summary?.totalInvested) || 0;
  const totalCurrentValue = Number(summary?.totalCurrentValue) || 0;
  const totalPnL = Number(summary?.totalPnL) || 0;
  const returnPct = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;

  const filtered = activeType === 'all' ? items : items.filter((i) => i.type === activeType);

  // Allocation by type across the whole portfolio (current value).
  const allocationMap = {};
  for (const it of items) {
    const v = Number(it.currentValue) || 0;
    if (v <= 0) continue;
    const key = it.type || 'other';
    allocationMap[key] = (allocationMap[key] || 0) + v;
  }
  const allocationData = Object.entries(allocationMap).map(([type, value]) => ({
    name: TYPE_META[type]?.label ?? type,
    value,
    amount: value,
  }));

  if (loading) return <InvestmentsSkeleton />;

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
            Investments
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
            Track your wealth growth
          </p>
        </div>
        <Button variant="primary" onClick={openCreate}>
          <Plus size={16} strokeWidth={2} />
          Add Investment
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

      {summary && (
        <>
          {/* Summary strip */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
              gap: 12,
              marginBottom: 24,
            }}
          >
            <StatChip label="Total Invested" value={format(totalInvested)} icon={TrendingUp} />
            <StatChip label="Current Value" value={format(totalCurrentValue)} icon={DollarSign} />
            <StatChip
              label="Total P&L"
              value={`${totalPnL >= 0 ? '+' : ''}${format(totalPnL)}`}
              valueColor={totalPnL >= 0 ? 'var(--green)' : 'var(--red)'}
              icon={totalPnL >= 0 ? TrendingUp : TrendingDown}
              iconColor={totalPnL >= 0 ? 'var(--green)' : 'var(--red)'}
            />
            <StatChip
              label="Return %"
              value={`${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(1)}%`}
              valueColor={returnPct >= 0 ? 'var(--green)' : 'var(--red)'}
              icon={returnPct >= 0 ? TrendingUp : TrendingDown}
              iconColor={returnPct >= 0 ? 'var(--green)' : 'var(--red)'}
            />
          </div>

          {/* Portfolio trend chart */}
          {snapshots.length >= 2 && (
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
                  Portfolio Growth
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  Net worth over last 30 days
                </div>
              </div>
              <AreaChartCard
                data={snapshots}
                dataKey="netWorth"
                xKey="label"
                height={isMobile ? 180 : 240}
                card={false}
              />
            </div>
          )}
        </>
      )}

      {items.length === 0 ? (
        <EmptyState onAdd={openCreate} />
      ) : (
        <>
          {/* Type filter pills */}
          <div
            className="no-scrollbar"
            style={{ display: 'flex', gap: 8, marginBottom: 20, overflowX: 'auto', paddingBottom: 4 }}
          >
            {TYPE_FILTERS.map((f) => (
              <FilterPill key={f.id} active={activeType === f.id} onClick={() => setActiveType(f.id)}>
                {f.label}
              </FilterPill>
            ))}
          </div>

          {/* List: table (desktop) or cards (mobile) */}
          {isMobile ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {filtered.map((item) => (
                <InvestmentCard
                  key={item._id}
                  item={item}
                  format={format}
                  onEdit={() => openEdit(item)}
                  onDelete={() => handleDelete(item)}
                />
              ))}
            </div>
          ) : (
            <div
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
                    <Th>Name</Th>
                    <Th>Type</Th>
                    <Th align="right">Qty</Th>
                    <Th align="right">Buy Price</Th>
                    <Th align="right">Current</Th>
                    <Th align="right">P&L</Th>
                    <Th align="right">Return</Th>
                    <Th align="right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item, idx) => {
                    const meta = TYPE_META[item.type] ?? { label: item.type, badge: 'default' };
                    const gain = Number(item.gainLoss) || 0;
                    const pct = Number(item.gainLossPercent) || 0;
                    const hasCurrent = item.currentPrice !== null && item.currentPrice !== undefined;
                    const TrendIcon = pct >= 0 ? TrendingUp : TrendingDown;
                    return (
                      <tr
                        key={item._id}
                        className="tx-row"
                        style={{
                          borderBottom:
                            idx === filtered.length - 1 ? 'none' : '1px solid var(--border-subtle)',
                        }}
                      >
                        <Td>
                          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                            {item.name}
                          </div>
                          {item.symbol && (
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.symbol}</div>
                          )}
                        </Td>
                        <Td>
                          <Badge variant={meta.badge}>{meta.label}</Badge>
                        </Td>
                        <Td align="right" style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
                          {item.quantity}
                        </Td>
                        <Td align="right" style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>
                          {format(item.buyPrice)}
                        </Td>
                        <Td
                          align="right"
                          style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: 'var(--text-primary)' }}
                        >
                          {hasCurrent ? format(item.currentPrice) : '—'}
                        </Td>
                        <Td
                          align="right"
                          style={{
                            fontVariantNumeric: 'tabular-nums',
                            fontWeight: 600,
                            color: gain >= 0 ? 'var(--green)' : 'var(--red)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {gain >= 0 ? '+' : '-'}
                          {format(Math.abs(gain))}
                        </Td>
                        <Td align="right">
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'flex-end',
                              gap: 3,
                              fontSize: 13,
                              fontWeight: 500,
                              fontVariantNumeric: 'tabular-nums',
                              color: pct >= 0 ? 'var(--green)' : 'var(--red)',
                            }}
                          >
                            <TrendIcon size={13} strokeWidth={2} />
                            {pct >= 0 ? '+' : ''}
                            {pct.toFixed(1)}%
                          </span>
                        </Td>
                        <Td align="right">
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
                            <IconBtn icon={Pencil} label="Edit" onClick={() => openEdit(item)} />
                            <IconBtn icon={Trash2} label="Delete" danger onClick={() => handleDelete(item)} />
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Allocation donut */}
          {allocationData.length > 0 && (
            <div
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                padding: 20,
                boxShadow: 'var(--shadow-sm)',
                marginTop: 24,
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 16 }}>
                Portfolio Allocation
              </div>
              <DonutChart
                data={allocationData}
                height={isMobile ? 200 : 240}
                centerValue={format(totalCurrentValue)}
                centerLabel="Portfolio"
                valueFormatter={(n) => format(n)}
              />
            </div>
          )}
        </>
      )}

      {/* Add / Edit modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Investment' : 'Add Investment'}>
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

          {/* Type pill selector */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {TYPES.map((t) => {
              const active = form.type === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm({ ...form, type: t })}
                  style={{
                    borderRadius: 'var(--radius-full)',
                    padding: '8px 16px',
                    fontSize: 13,
                    fontWeight: 500,
                    fontFamily: 'Poppins',
                    cursor: 'pointer',
                    border: '1px solid ' + (active ? 'var(--accent)' : 'var(--border)'),
                    background: active ? 'var(--accent)' : 'var(--bg-elevated)',
                    color: active ? '#fff' : 'var(--text-secondary)',
                    transition: 'all 150ms var(--ease)',
                  }}
                >
                  {TYPE_META[t].label}
                </button>
              );
            })}
          </div>

          <Input
            label="Name"
            type="text"
            required
            maxLength={100}
            placeholder="e.g. Reliance, Bitcoin"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Input
            label="Symbol"
            type="text"
            placeholder="e.g. RELIANCE, BTC"
            hint="Used for live pricing on stock and crypto."
            value={form.symbol}
            onChange={(e) => setForm({ ...form, symbol: e.target.value })}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input
              label="Quantity"
              type="number"
              step="any"
              min="0.0001"
              max="999999999.99"
              required
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            />
            <Input
              label="Buy Price"
              prefix="₹"
              type="number"
              step="0.01"
              min="0.01"
              max="999999999.99"
              required
              value={form.buyPrice}
              onChange={(e) => setForm({ ...form, buyPrice: e.target.value })}
            />
          </div>
          <Input
            label="Current Price (optional)"
            prefix="₹"
            type="number"
            step="0.01"
            min="0"
            value={form.currentPrice}
            onChange={(e) => setForm({ ...form, currentPrice: e.target.value })}
          />
          <Input
            label="Buy Date"
            type="date"
            value={form.buyDate}
            onChange={(e) => setForm({ ...form, buyDate: e.target.value })}
          />
          <Input
            label="Notes (optional)"
            type="text"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
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

function InvestmentCard({ item, format, onEdit, onDelete }) {
  const meta = TYPE_META[item.type] ?? { label: item.type, badge: 'default' };
  const gain = Number(item.gainLoss) || 0;
  const pct = Number(item.gainLossPercent) || 0;
  const hasCurrent = item.currentPrice !== null && item.currentPrice !== undefined;
  const gainColor = gain >= 0 ? 'var(--green)' : 'var(--red)';

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {item.name}
          </div>
          {item.symbol && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.symbol}</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <Badge variant={meta.badge}>{meta.label}</Badge>
          <IconBtn icon={Pencil} label="Edit" onClick={onEdit} />
          <IconBtn icon={Trash2} label="Delete" danger onClick={onDelete} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
        <PriceBox label="Buy Price" value={format(item.buyPrice)} />
        <PriceBox label="Current" value={hasCurrent ? format(item.currentPrice) : '—'} />
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 12,
          paddingTop: 12,
          borderTop: '1px solid var(--border-subtle)',
        }}
      >
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Qty: {item.quantity}</span>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <span style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: gainColor }}>
            {gain >= 0 ? '+' : '-'}
            {format(Math.abs(gain))}
          </span>
          <span style={{ fontSize: 12, fontWeight: 500, color: gainColor }}>
            {pct >= 0 ? '+' : ''}
            {pct.toFixed(1)}%
          </span>
        </div>
      </div>
    </div>
  );
}

function PriceBox({ label, value }) {
  return (
    <div>
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
      <div style={{ fontSize: 16, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)', marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}

function StatChip({ label, value, valueColor = 'var(--text-primary)', icon: Icon, iconColor = 'var(--text-muted)' }) {
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--text-muted)',
          }}
        >
          {label}
        </span>
        {Icon && <Icon size={16} strokeWidth={1.75} color={iconColor} />}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: valueColor, marginTop: 6 }}>
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
        width: 30,
        height: 30,
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
      <BarChart2 size={48} strokeWidth={1.5} color="var(--text-muted)" />
      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)', marginTop: 12 }}>
        No investments tracked
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
        Add your stocks, crypto, mutual funds and FDs to track returns
      </div>
      <div style={{ marginTop: 16 }}>
        <Button variant="primary" onClick={onAdd}>
          <Plus size={16} strokeWidth={2} />
          Add Investment
        </Button>
      </div>
    </div>
  );
}
