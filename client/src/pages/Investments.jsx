import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BarChart2,
  Bitcoin,
  Package,
  Pencil,
  PiggyBank,
  Plus,
  TrendingDown,
  TrendingUp,
  Trash2,
  Wallet,
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
import StatCard from '../components/ui/StatCard';

const TYPES = ['stock', 'crypto', 'mutual_fund', 'fd', 'other'];

const TYPE_META = {
  stock: { Icon: BarChart2, color: '#f59e0b', label: 'Stock' },
  crypto: { Icon: Bitcoin, color: '#f59e0b', label: 'Crypto' },
  mutual_fund: { Icon: TrendingUp, color: '#22c55e', label: 'Mutual Fund' },
  fd: { Icon: PiggyBank, color: '#06b6d4', label: 'FD' },
  other: { Icon: Package, color: '#a1a1aa', label: 'Other' },
};

function typeMeta(type) {
  return TYPE_META[type] ?? { Icon: Package, color: '#a1a1aa', label: type || 'Other' };
}

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

/** Number-or-dash helper for optional numeric cells. */
function numOrDash(v) {
  return v === null || v === undefined || v === '' ? '—' : v;
}

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

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

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
        item.currentPrice === null || item.currentPrice === undefined ? '' : String(item.currentPrice),
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

  async function confirmDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await apiClient.delete(`/investments/${deleteTarget._id}`);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(extractError(err, 'Unable to delete investment'));
    } finally {
      setDeleting(false);
    }
  }

  const items = summary?.items ?? [];
  const totalInvested = Number(summary?.totalInvested) || 0;
  const totalCurrentValue = Number(summary?.totalCurrentValue) || 0;
  const totalPnL = Number(summary?.totalPnL) || 0;
  const returnPct = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;
  const pnlPositive = totalPnL >= 0;

  // Client-side type filter for the list below (does NOT affect the donut).
  const filtered = activeType === 'all' ? items : items.filter((i) => i.type === activeType);

  // Allocation by type — always reflects the FULL list, never the filter.
  const allocationMap = {};
  for (const it of items) {
    const v = Number(it.currentValue) || 0;
    if (v <= 0) continue;
    const key = it.type || 'other';
    allocationMap[key] = (allocationMap[key] || 0) + v;
  }
  const allocationData = Object.entries(allocationMap).map(([type, value]) => ({
    name: typeMeta(type).label,
    value,
    amount: value,
  }));

  // Type filter pills: "All" + only the types that actually have holdings.
  const FILTER_LABELS = {
    stock: 'Stocks',
    crypto: 'Crypto',
    mutual_fund: 'Mutual Funds',
    fd: 'FDs',
    other: 'Other',
  };
  const presentTypes = TYPES.filter((t) => items.some((i) => i.type === t));
  const typeFilters = [
    { id: 'all', label: 'All' },
    ...presentTypes.map((t) => ({ id: t, label: FILTER_LABELS[t] ?? typeMeta(t).label })),
  ];

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
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
            Investments
          </h1>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 4 }}>
            Every holding, every gain and loss, tracked live.
          </p>
        </div>
        <Button variant="primary" onClick={openCreate}>
          <Plus size={16} strokeWidth={2} />
          New investment
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

      {/* Type filter pills */}
      {items.length > 0 && typeFilters.length > 1 && (
        <div
          className="no-scrollbar"
          style={{ display: 'flex', flexWrap: isMobile ? 'nowrap' : 'wrap', gap: 8, overflowX: 'auto', paddingBottom: 4, marginBottom: 20 }}
        >
          {typeFilters.map((f) => (
            <FilterPill key={f.id} active={activeType === f.id} onClick={() => setActiveType(f.id)}>
              {f.label}
            </FilterPill>
          ))}
        </div>
      )}

      {summary && (
        <>
          {/* Summary strip */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
              gap: 16,
              marginBottom: 24,
            }}
          >
            <StatCard label="Total Invested" value={format(totalInvested)} icon={Wallet} iconColor="var(--accent)" />
            <StatCard label="Current Value" value={format(totalCurrentValue)} icon={TrendingUp} iconColor="var(--accent)" />
            <StatCard
              label="Total P&L"
              value={`${pnlPositive ? '+' : '-'}${format(Math.abs(totalPnL))} (${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(1)}%)`}
              icon={pnlPositive ? TrendingUp : TrendingDown}
              iconColor={pnlPositive ? 'var(--green)' : 'var(--red)'}
              valueColor={pnlPositive ? 'var(--green)' : 'var(--red)'}
            />
          </div>

          {/* Allocation donut — always reflects the full list, not the filter */}
          {allocationData.length >= 2 && (
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
                  Allocation by Type
                </div>
                <div className="text-caption">Current investment mix</div>
              </div>
              <DonutChart
                data={allocationData}
                height={isMobile ? 200 : 240}
                centerValue={format(totalCurrentValue)}
                centerLabel="Total"
                valueFormatter={(n) => format(n)}
              />
            </div>
          )}

          {/* Growth trend chart */}
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
                <div className="text-subhead" style={{ color: 'var(--text-primary)' }}>
                  Portfolio Growth
                </div>
                <div className="text-caption">Net worth over last 30 days</div>
              </div>
              <AreaChartCard data={snapshots} dataKey="netWorth" xKey="label" height={isMobile ? 180 : 240} card={false} />
            </div>
          )}
        </>
      )}

      {items.length === 0 ? (
        <EmptyState onAdd={openCreate} />
      ) : filtered.length === 0 ? (
        <FilteredEmptyState
          typeLabel={(FILTER_LABELS[activeType] ?? typeMeta(activeType).label).toLowerCase()}
          onClear={() => setActiveType('all')}
        />
      ) : isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map((item) => (
            <InvestmentCard
              key={item._id}
              item={item}
              format={format}
              onEdit={() => openEdit(item)}
              onDelete={() => setDeleteTarget(item)}
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
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <Th>Investment</Th>
                <Th>Type</Th>
                <Th align="right">Units</Th>
                <Th align="right">Buy Price</Th>
                <Th align="right">Current Value</Th>
                <Th align="right">P&L</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, idx) => {
                const meta = typeMeta(item.type);
                const gain = Number(item.gainLoss) || 0;
                const pct = Number(item.gainLossPercent) || 0;
                const gainColor = gain >= 0 ? 'var(--green)' : 'var(--red)';
                return (
                  <tr
                    key={item._id}
                    className="tx-row"
                    style={{ borderBottom: idx === filtered.length - 1 ? 'none' : '1px solid var(--border-subtle)' }}
                  >
                    <Td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <TypeIcon meta={meta} />
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>{item.name}</div>
                          {item.symbol && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.symbol}</div>}
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <Badge variant="default">{meta.label}</Badge>
                    </Td>
                    <Td align="right" style={{ fontSize: 13, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                      {numOrDash(item.quantity)}
                    </Td>
                    <Td align="right" style={{ fontSize: 13, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                      {item.buyPrice != null ? format(item.buyPrice) : '—'}
                    </Td>
                    <Td align="right" style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                      {item.currentValue != null ? format(item.currentValue) : '—'}
                    </Td>
                    <Td align="right">
                      <div style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: gainColor, whiteSpace: 'nowrap' }}>
                        {gain >= 0 ? '+' : '-'}
                        {format(Math.abs(gain))}
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 500, color: gainColor }}>
                        ({pct >= 0 ? '+' : ''}
                        {pct.toFixed(1)}%)
                      </div>
                    </Td>
                    <Td align="right">
                      <span className="tx-actions" style={{ display: 'inline-flex', gap: 4 }}>
                        <IconBtn icon={Pencil} label="Edit" small onClick={() => openEdit(item)} />
                        <IconBtn icon={Trash2} label="Delete" small danger onClick={() => setDeleteTarget(item)} />
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add / Edit modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Investment' : 'New Investment'}>
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
          <StyledSelect
            label="Type"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            options={TYPES.map((t) => ({ value: t, label: typeMeta(t).label }))}
          />
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
              label="Units"
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
            Delete this investment?
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

function InvestmentCard({ item, format, onEdit, onDelete }) {
  const meta = typeMeta(item.type);
  const gain = Number(item.gainLoss) || 0;
  const pct = Number(item.gainLossPercent) || 0;
  const gainColor = gain >= 0 ? 'var(--green)' : 'var(--red)';

  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderLeft: `4px solid ${meta.color}`,
        borderRadius: 'var(--radius-lg)',
        padding: 16,
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <TypeIcon meta={meta} />
          <div style={{ minWidth: 0 }}>
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
              {item.name}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {item.symbol ? `${item.symbol} · ${meta.label}` : meta.label}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
          <IconBtn icon={Pencil} label="Edit" small onClick={onEdit} />
          <IconBtn icon={Trash2} label="Delete" small danger onClick={onDelete} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
        <MiniStat label="Invested" value={item.invested != null ? format(item.invested) : '—'} />
        <MiniStat label="Current" value={item.currentValue != null ? format(item.currentValue) : '—'} />
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
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Profit / Loss</span>
        <span style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: gainColor }}>
          {gain >= 0 ? '+' : '-'}
          {format(Math.abs(gain))} ({pct >= 0 ? '+' : ''}
          {pct.toFixed(1)}%)
        </span>
      </div>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)', marginTop: 2 }}>
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
        border: '1px solid ' + (active || hover ? 'var(--accent)' : 'var(--border)'),
        background: active ? 'var(--accent)' : 'var(--bg-elevated)',
        color: active ? '#fff' : hover ? 'var(--text-primary)' : 'var(--text-secondary)',
      }}
    >
      {children}
    </button>
  );
}

function FilteredEmptyState({ typeLabel, onClear }) {
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
      <TrendingUp size={48} strokeWidth={1.5} color="var(--text-muted)" />
      <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginTop: 12 }}>
        No {typeLabel} investments yet
      </div>
      <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 6 }}>
        Try a different filter to see your other holdings.
      </div>
      <div style={{ marginTop: 16 }}>
        <Button variant="ghost" onClick={onClear}>
          Clear filter
        </Button>
      </div>
    </div>
  );
}

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
      <TrendingUp size={48} strokeWidth={1.5} color="var(--text-muted)" />
      <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginTop: 12 }}>
        No investments tracked
      </div>
      <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 6 }}>
        Track stocks, mutual funds, crypto, and more to watch your wealth grow.
      </div>
      <div style={{ marginTop: 16 }}>
        <Button variant="primary" onClick={onAdd}>
          <Plus size={16} strokeWidth={2} />
          New investment
        </Button>
      </div>
    </div>
  );
}
