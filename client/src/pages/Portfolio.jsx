import { useEffect, useMemo, useState } from 'react';
import {
  BarChart2,
  Bitcoin,
  Briefcase,
  Building2,
  Gem,
  Home,
  Landmark,
  Pencil,
  PiggyBank,
  Plus,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import apiClient from '../api/client';
import { useDisplayCurrency } from '../currency/CurrencyContext';
import { extractError } from '../lib/format';
import { sanitizeInput } from '../utils/sanitize';
import PortfolioSkeleton from '../components/skeletons/PortfolioSkeleton';
import DonutChart from '../components/charts/DonutChart';
import AreaChartCard from '../components/charts/AreaChartCard';
import useSnapshots from '../hooks/useSnapshots';
import useWindowSize from '../hooks/useWindowSize';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';

/**
 * Portfolio overview. A unified `/portfolio` resource backs every asset kind
 * via a `kind` discriminator; the backend computes invested / current value /
 * returns and a per-kind allocation on every request.
 *
 * Endpoints (unchanged):
 *   GET    /portfolio/summary
 *   POST   /portfolio        (body carries `kind`)
 *   PUT    /portfolio/:id
 *   DELETE /portfolio/:id
 */
const KINDS = [
  {
    kind: 'fd',
    label: 'Fixed Deposits',
    singular: 'Fixed Deposit',
    fields: [
      { key: 'name', label: 'Bank Name', type: 'text', required: true },
      { key: 'principal', label: 'Principal', type: 'number' },
      { key: 'interestRate', label: 'Interest Rate (%)', type: 'number' },
      {
        key: 'compounding',
        label: 'Compounding',
        type: 'select',
        options: ['monthly', 'quarterly', 'yearly'],
        default: 'yearly',
      },
      { key: 'startDate', label: 'Start Date', type: 'date' },
      { key: 'tenureMonths', label: 'Tenure (months)', type: 'number' },
      { key: 'currentValue', label: 'Maturity Value (optional)', type: 'number' },
    ],
  },
  {
    kind: 'bank',
    label: 'Bank Accounts',
    singular: 'Bank Account',
    fields: [
      { key: 'name', label: 'Bank Name', type: 'text', required: true },
      {
        key: 'accountType',
        label: 'Account Type',
        type: 'select',
        options: ['savings', 'current', 'salary'],
        default: 'savings',
      },
      { key: 'currentBalance', label: 'Current Balance', type: 'number' },
    ],
  },
  {
    kind: 'mutual_fund',
    label: 'Mutual Funds',
    singular: 'Mutual Fund',
    fields: [
      { key: 'name', label: 'Fund Name', type: 'text', required: true },
      { key: 'units', label: 'Units', type: 'number' },
      { key: 'buyPrice', label: 'Avg Buy NAV', type: 'number' },
      { key: 'currentPrice', label: 'Current NAV', type: 'number' },
    ],
  },
  {
    kind: 'stock',
    label: 'Stocks',
    singular: 'Stock',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'symbol', label: 'Symbol', type: 'text' },
      { key: 'units', label: 'Quantity', type: 'number' },
      { key: 'buyPrice', label: 'Buy Price', type: 'number' },
      { key: 'currentPrice', label: 'Current Price', type: 'number' },
    ],
  },
  {
    kind: 'crypto',
    label: 'Crypto',
    singular: 'Crypto',
    fields: [
      { key: 'name', label: 'Coin', type: 'text', required: true },
      { key: 'symbol', label: 'Symbol', type: 'text' },
      { key: 'units', label: 'Quantity', type: 'number' },
      { key: 'buyPrice', label: 'Buy Price', type: 'number' },
      { key: 'currentPrice', label: 'Current Price', type: 'number' },
    ],
  },
  {
    kind: 'ppf_epf',
    label: 'PPF / EPF',
    singular: 'PPF / EPF',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      {
        key: 'accountType',
        label: 'Account Type',
        type: 'select',
        options: ['PPF', 'EPF'],
        default: 'PPF',
      },
      { key: 'currentBalance', label: 'Corpus', type: 'number' },
      { key: 'yearlyContribution', label: 'Yearly Contribution', type: 'number' },
    ],
  },
  {
    kind: 'real_estate',
    label: 'Real Estate',
    singular: 'Property',
    fields: [
      { key: 'name', label: 'Property', type: 'text', required: true },
      { key: 'principal', label: 'Purchase Value', type: 'number' },
      { key: 'currentValue', label: 'Current Est. Value', type: 'number' },
    ],
  },
  {
    kind: 'gold',
    label: 'Gold',
    singular: 'Gold',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, default: 'Gold' },
      { key: 'units', label: 'Grams', type: 'number' },
      { key: 'buyPrice', label: 'Buy Price (per gram)', type: 'number' },
      { key: 'currentPrice', label: 'Current Price (per gram)', type: 'number' },
    ],
  },
];

const KIND_LABEL = KINDS.reduce((acc, k) => {
  acc[k.kind] = k.label;
  return acc;
}, {});

const KIND_VISUAL = {
  fd: { Icon: Landmark, color: '#06b6d4' },
  bank: { Icon: Building2, color: '#7c6ee8' },
  mutual_fund: { Icon: TrendingUp, color: '#22c55e' },
  stock: { Icon: BarChart2, color: '#f59e0b' },
  crypto: { Icon: Bitcoin, color: '#f59e0b' },
  ppf_epf: { Icon: PiggyBank, color: '#22c55e' },
  real_estate: { Icon: Home, color: '#ef4444' },
  gold: { Icon: Gem, color: '#f59e0b' },
};

const MONEY_KEYS = new Set([
  'principal',
  'currentValue',
  'buyPrice',
  'currentPrice',
  'currentBalance',
  'yearlyContribution',
]);

function emptyFormFor(config) {
  const form = {};
  for (const field of config.fields) {
    if (field.type === 'select') form[field.key] = field.default ?? field.options[0];
    else form[field.key] = field.default ?? '';
  }
  return form;
}

function formFromItem(config, item) {
  const form = {};
  for (const field of config.fields) {
    const value = item[field.key];
    if (field.type === 'number') {
      form[field.key] = value === null || value === undefined ? '' : String(value);
    } else if (field.type === 'date') {
      form[field.key] = value ? String(value).slice(0, 10) : '';
    } else if (field.type === 'select') {
      form[field.key] = value ?? field.default ?? field.options[0];
    } else {
      form[field.key] = value ?? '';
    }
  }
  return form;
}

function shortMonthYear(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

function fdMaturity(item) {
  if (!item.startDate || item.tenureMonths == null) return null;
  const d = new Date(item.startDate);
  if (Number.isNaN(d.getTime())) return null;
  d.setMonth(d.getMonth() + Number(item.tenureMonths));
  return d;
}

function daysUntilDate(d) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const t = new Date(d);
  t.setHours(0, 0, 0, 0);
  return Math.round((t - today) / 86400000);
}

/** Metric column definitions per kind (everything except name + actions). */
function metricDefs(kind) {
  switch (kind) {
    case 'fd':
      return [
        { label: 'Interest', align: 'right', render: (i) => (i.interestRate != null ? `${i.interestRate}%` : '—') },
        { label: 'Principal', align: 'right', money: true, get: (i) => i.principal },
        { label: 'Maturity Value', align: 'right', money: true, get: (i) => i.currentValue },
        { label: 'Maturity', align: 'right', maturity: true },
      ];
    case 'bank':
      return [
        { label: 'Account Type', align: 'left', render: (i) => i.accountType || '—' },
        { label: 'Balance', align: 'right', money: true, get: (i) => i.currentValue ?? i.currentBalance, color: () => 'var(--green)' },
      ];
    case 'ppf_epf':
      return [
        { label: 'Account Type', align: 'left', render: (i) => i.accountType || '—' },
        { label: 'Corpus', align: 'right', money: true, get: (i) => i.currentValue ?? i.currentBalance },
      ];
    case 'real_estate':
      return [
        { label: 'Purchase', align: 'right', money: true, get: (i) => i.invested ?? i.principal },
        { label: 'Current Value', align: 'right', money: true, get: (i) => i.currentValue },
        { label: 'Gain/Loss', align: 'right', money: true, signed: true, get: (i) => i.returns, color: (i) => (i.returns >= 0 ? 'var(--green)' : 'var(--red)') },
      ];
    case 'gold':
      return [
        { label: 'Grams', align: 'right', render: (i) => i.units ?? '—' },
        { label: 'Buy/g', align: 'right', money: true, get: (i) => i.buyPrice },
        { label: 'Current Value', align: 'right', money: true, get: (i) => i.currentValue },
      ];
    default:
      return [
        { label: 'Units', align: 'right', render: (i) => i.units ?? '—' },
        { label: 'Buy Price', align: 'right', money: true, get: (i) => i.buyPrice },
        { label: 'Current Value', align: 'right', money: true, get: (i) => i.currentValue },
        { label: 'P&L', align: 'right', money: true, signed: true, get: (i) => i.returns, color: (i) => (i.returns >= 0 ? 'var(--green)' : 'var(--red)') },
      ];
  }
}

/** Resolve a metric def to a { text, color } pair for an item. */
function renderMetric(def, item, format) {
  if (def.maturity) {
    const m = fdMaturity(item);
    if (!m) return { text: '—', color: 'var(--text-primary)' };
    const d = daysUntilDate(m);
    const soon = d >= 0 && d <= 30;
    return { text: shortMonthYear(m), color: soon ? 'var(--amber)' : 'var(--text-primary)' };
  }
  if (def.render) return { text: String(def.render(item)), color: 'var(--text-primary)' };
  const raw = def.get ? def.get(item) : undefined;
  if (raw === null || raw === undefined || raw === '') return { text: '—', color: 'var(--text-muted)' };
  const color = def.color ? def.color(item) : 'var(--text-primary)';
  if (def.money) {
    if (def.signed) {
      const n = Number(raw) || 0;
      return { text: `${n >= 0 ? '+' : '-'}${format(Math.abs(n))}`, color };
    }
    return { text: format(raw), color };
  }
  return { text: String(raw), color };
}

export default function Portfolio() {
  const { format } = useDisplayCurrency();
  const { isMobile } = useWindowSize();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [activeKind, setActiveKind] = useState('stock');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data } = await apiClient.get('/portfolio/summary');
      setSummary(data);
    } catch (err) {
      setError(extractError(err, 'Unable to load portfolio'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // After the page's own fetch effect so snapshots don't pre-empt it.
  const { snapshots } = useSnapshots();

  const config = useMemo(() => KINDS.find((k) => k.kind === activeKind) ?? KINDS[0], [activeKind]);

  const itemsByKind = useMemo(() => {
    const map = {};
    for (const k of KINDS) map[k.kind] = [];
    for (const item of summary?.items ?? []) {
      if (!map[item.kind]) map[item.kind] = [];
      map[item.kind].push(item);
    }
    return map;
  }, [summary]);

  const pieData = useMemo(
    () =>
      (summary?.allocation ?? []).map((slice) => ({
        name: KIND_LABEL[slice.kind] ?? slice.kind,
        value: slice.value,
        amount: slice.value,
        percent: slice.percent,
      })),
    [summary],
  );

  function openCreate(kind) {
    setActiveKind(kind);
    const cfg = KINDS.find((k) => k.kind === kind) ?? KINDS[0];
    setEditing(null);
    setForm(emptyFormFor(cfg));
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(item) {
    const cfg = KINDS.find((k) => k.kind === item.kind) ?? KINDS[0];
    setActiveKind(item.kind);
    setEditing(item);
    setForm(formFromItem(cfg, item));
    setFormError(null);
    setModalOpen(true);
  }

  function validate() {
    if (!String(form.name ?? '').trim()) return 'Name is required.';
    if (String(form.name).length > 100) return 'Name must be 1 to 100 characters.';
    for (const field of config.fields) {
      if (field.type !== 'number') continue;
      const raw = form[field.key];
      if (raw === '' || raw === undefined || raw === null) continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) return `${field.label} must be a valid number.`;
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
      const payload = { kind: activeKind };
      for (const field of config.fields) {
        const raw = form[field.key];
        if (field.type === 'number') {
          if (raw !== '' && raw !== undefined && raw !== null) payload[field.key] = Number(raw);
        } else if (field.type === 'date') {
          if (raw) payload[field.key] = raw;
        } else {
          payload[field.key] = typeof raw === 'string' ? sanitizeInput(raw.trim()) : raw;
        }
      }

      if (editing) {
        await apiClient.put(`/portfolio/${editing._id}`, payload);
      } else {
        await apiClient.post('/portfolio', payload);
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(extractError(err, 'Unable to save item'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(item) {
    if (typeof window !== 'undefined' && !window.confirm(`Delete ${item.name}?`)) return;
    try {
      await apiClient.delete(`/portfolio/${item._id}`);
      await load();
    } catch (err) {
      setError(extractError(err, 'Unable to delete item'));
    }
  }

  if (loading) return <PortfolioSkeleton />;

  const items = summary?.items ?? [];
  const isEmpty = items.length === 0;

  // Quick stats counts.
  const counts = {};
  for (const it of items) counts[it.kind] = (counts[it.kind] || 0) + 1;
  const quickStats = [
    { label: 'Fixed Deposits', n: counts.fd || 0 },
    { label: 'Bank Accounts', n: counts.bank || 0 },
    { label: 'Mutual Funds', n: counts.mutual_fund || 0 },
    { label: 'Stocks & Crypto', n: (counts.stock || 0) + (counts.crypto || 0) },
    { label: 'PPF / EPF', n: counts.ppf_epf || 0 },
    { label: 'Real Estate', n: counts.real_estate || 0 },
    { label: 'Gold', n: counts.gold || 0 },
  ].filter((s) => s.n > 0);

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
          Portfolio
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
          Your complete wealth picture
        </p>
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
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
            gap: 12,
            marginBottom: 24,
          }}
        >
          <SummaryChip label="Total Value" value={format(summary.totalCurrentValue)} color="var(--text-primary)" />
          <SummaryChip label="Total Invested" value={format(summary.totalInvested)} color="var(--text-muted)" />
          <SummaryChip
            label="Total Returns"
            value={`${summary.totalReturns >= 0 ? '+' : ''}${format(summary.totalReturns)}`}
            color={summary.totalReturns >= 0 ? 'var(--green)' : 'var(--red)'}
          />
        </div>
      )}

      {/* Portfolio trend */}
      {snapshots.length >= 2 && (
        <SectionCard style={{ marginBottom: 24 }}>
          <CardHeader title="Portfolio Value" subtitle="Last 30 days" />
          <AreaChartCard data={snapshots} dataKey="netWorth" xKey="label" height={isMobile ? 180 : 240} card={false} />
        </SectionCard>
      )}

      {/* Allocation + quick stats */}
      {!isEmpty && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
            gap: 20,
            marginBottom: 24,
          }}
        >
          <SectionCard>
            <CardHeader title="Asset Allocation" subtitle="By asset type" />
            {pieData.length > 0 ? (
              <DonutChart
                data={pieData}
                centerValue={format(summary.totalCurrentValue)}
                centerLabel="Total"
                height={isMobile ? 200 : 240}
                valueFormatter={(n) => format(n)}
              />
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No allocation data.</div>
            )}
          </SectionCard>

          <SectionCard>
            <CardHeader title="Quick Stats" />
            <div>
              {quickStats.map((s, idx) => (
                <div
                  key={s.label}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 0',
                    borderBottom: idx === quickStats.length - 1 ? 'none' : '1px solid var(--border-subtle)',
                  }}
                >
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{s.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
                    {s.n}
                  </span>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      )}

      {/* Empty state or sections */}
      {isEmpty ? (
        <EmptyState onAdd={openCreate} />
      ) : (
        KINDS.map((cfg) => {
          const kindItems = itemsByKind[cfg.kind] ?? [];
          if (kindItems.length === 0) return null;
          return (
            <KindSection
              key={cfg.kind}
              config={cfg}
              items={kindItems}
              isMobile={isMobile}
              format={format}
              onAdd={() => openCreate(cfg.kind)}
              onEdit={openEdit}
              onDelete={handleDelete}
            />
          );
        })
      )}

      {/* Add / edit modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit ${config.singular}` : `Add ${config.singular}`}
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
          {config.fields.map((field) =>
            field.type === 'select' ? (
              <StyledSelect
                key={field.key}
                label={field.label}
                value={form[field.key] ?? ''}
                onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                options={field.options}
              />
            ) : (
              <Input
                key={field.key}
                label={field.label}
                type={field.type}
                {...(MONEY_KEYS.has(field.key) ? { prefix: '₹' } : {})}
                {...(field.type === 'number' ? { step: 'any', min: '0' } : {})}
                {...(field.required ? { required: true, maxLength: 100 } : {})}
                value={form[field.key] ?? ''}
                onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
              />
            ),
          )}
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

/* ── Section + helpers ─────────────────────────────────────────────────────*/

function KindSection({ config, items, isMobile, format, onAdd, onEdit, onDelete }) {
  const { Icon, color } = KIND_VISUAL[config.kind] ?? { Icon: Briefcase, color: '#a1a1aa' };
  const defs = metricDefs(config.kind);
  const sectionTotal = items.reduce((s, i) => s + (Number(i.currentValue) || 0), 0);

  return (
    <div style={{ marginTop: 28 }}>
      {/* Section header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
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
          <Icon size={18} strokeWidth={1.75} />
        </span>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>{config.label}</h2>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 14,
            fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--text-primary)',
          }}
        >
          {format(sectionTotal)}
        </span>
        <Button variant="ghost" size="sm" onClick={onAdd}>
          <Plus size={16} strokeWidth={2} />
          {!isMobile && `Add ${config.singular}`}
        </Button>
      </div>

      {/* Items */}
      {isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((item) => (
            <div
              key={item._id}
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                padding: 14,
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.name}
                  </div>
                  {(item.symbol || item.accountType) && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {item.symbol || item.accountType}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                  <IconBtn icon={Pencil} label="Edit" onClick={() => onEdit(item)} />
                  <IconBtn icon={Trash2} label="Delete" danger onClick={() => onDelete(item)} />
                </div>
              </div>
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {defs.map((def) => {
                  const { text, color: c } = renderMetric(def, item, format);
                  return (
                    <div key={def.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{def.label}</span>
                      <span style={{ fontSize: 13, fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: c }}>
                        {text}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
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
                {defs.map((d) => (
                  <Th key={d.label} align={d.align}>
                    {d.label}
                  </Th>
                ))}
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr
                  key={item._id}
                  className="tx-row"
                  style={{ borderBottom: idx === items.length - 1 ? 'none' : '1px solid var(--border-subtle)' }}
                >
                  <Td>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{item.name}</div>
                    {(item.symbol || item.accountType) && (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {item.symbol || item.accountType}
                      </div>
                    )}
                  </Td>
                  {defs.map((def) => {
                    const { text, color: c } = renderMetric(def, item, format);
                    return (
                      <Td key={def.label} align={def.align} style={{ fontVariantNumeric: 'tabular-nums', color: c, fontWeight: def.signed ? 600 : 400 }}>
                        {text}
                      </Td>
                    );
                  })}
                  <Td align="right">
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
                      <IconBtn icon={Pencil} label="Edit" onClick={() => onEdit(item)} />
                      <IconBtn icon={Trash2} label="Delete" danger onClick={() => onDelete(item)} />
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SectionCard({ children, style }) {
  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: 20,
        boxShadow: 'var(--shadow-sm)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function CardHeader({ title, subtitle }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>}
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
      <Briefcase size={48} strokeWidth={1.5} color="var(--text-muted)" />
      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)', marginTop: 12 }}>
        Your portfolio is empty
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
        Add your FDs, bank accounts, mutual funds, stocks and more
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 16 }}>
        <Button variant="ghost" size="sm" onClick={() => onAdd('fd')}>
          <Plus size={14} strokeWidth={2} />
          FD
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onAdd('bank')}>
          <Plus size={14} strokeWidth={2} />
          Bank
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onAdd('stock')}>
          <Plus size={14} strokeWidth={2} />
          Stock
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onAdd('crypto')}>
          <Plus size={14} strokeWidth={2} />
          Crypto
        </Button>
      </div>
    </div>
  );
}
