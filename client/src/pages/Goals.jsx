import { useEffect, useState } from 'react';
import { Calendar, CheckCircle2, Plus, Target, Trash2 } from 'lucide-react';
import apiClient from '../api/client';
import { useDisplayCurrency } from '../currency/CurrencyContext';
import { extractError } from '../lib/format';
import { sanitizeInput } from '../utils/sanitize';
import GoalsSkeleton from '../components/skeletons/GoalsSkeleton';
import useWindowSize from '../hooks/useWindowSize';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';

const EMPTY_FORM = { name: '', targetAmount: '', targetDate: '', category: '' };

const RING_RADIUS = 50;
const RING_CIRC = 2 * Math.PI * RING_RADIUS; // ≈ 314.16

/**
 * Goals list with create / contribute / delete. The backend PUT endpoint
 * uses additive contribution semantics (`{ amount }`), not field replacement,
 * so there is no full "edit goal" flow — see goalController.js.
 *
 * Backend endpoints (unchanged):
 *   GET    /goals
 *   POST   /goals
 *   PUT    /goals/:id  body: { amount }
 *   DELETE /goals/:id
 */
export default function Goals() {
  const { format } = useDisplayCurrency();
  const { width, isMobile } = useWindowSize();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [contribOpen, setContribOpen] = useState(false);
  const [contribTarget, setContribTarget] = useState(null);
  const [contribAmount, setContribAmount] = useState('');
  const [contribError, setContribError] = useState(null);
  const [contribSubmitting, setContribSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data } = await apiClient.get('/goals');
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(extractError(err, 'Unable to load goals'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setForm(EMPTY_FORM);
    setFormError(null);
    setCreateOpen(true);
  }

  function validateCreate() {
    if (!form.name.trim()) return 'Name is required.';
    if (form.name.length > 100) return 'Name must be 1 to 100 characters.';
    const num = Number(form.targetAmount);
    if (!Number.isFinite(num) || num < 0.01 || num > 999999999.99) {
      return 'Target amount must be between 0.01 and 999,999,999.99.';
    }
    return null;
  }

  async function handleCreate(event) {
    event.preventDefault();
    if (submitting) return;
    const message = validateCreate();
    if (message) {
      setFormError(message);
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const payload = {
        name: sanitizeInput(form.name.trim()),
        targetAmount: Number(form.targetAmount),
      };
      if (form.targetDate) payload.targetDate = form.targetDate;
      if (form.category) payload.category = sanitizeInput(form.category);
      await apiClient.post('/goals', payload);
      setCreateOpen(false);
      await load();
    } catch (err) {
      setFormError(extractError(err, 'Unable to create goal'));
    } finally {
      setSubmitting(false);
    }
  }

  function openContribute(goal) {
    setContribTarget(goal);
    setContribAmount('');
    setContribError(null);
    setContribOpen(true);
  }

  async function handleContribute(event) {
    event.preventDefault();
    if (contribSubmitting || !contribTarget) return;
    const num = Number(contribAmount);
    if (!Number.isFinite(num) || num < 0.01 || num > 999999999.99) {
      setContribError('Amount must be between 0.01 and 999,999,999.99.');
      return;
    }
    setContribSubmitting(true);
    setContribError(null);
    try {
      await apiClient.put(`/goals/${contribTarget._id}`, { amount: num });
      setContribOpen(false);
      await load();
    } catch (err) {
      setContribError(extractError(err, 'Unable to record contribution'));
    } finally {
      setContribSubmitting(false);
    }
  }

  async function handleDelete(goal) {
    if (typeof window !== 'undefined' && !window.confirm(`Delete goal ${goal.name}?`)) return;
    try {
      await apiClient.delete(`/goals/${goal._id}`);
      await load();
    } catch (err) {
      setError(extractError(err, 'Unable to delete goal'));
    }
  }

  const totalSaved = items.reduce((s, g) => s + (Number(g.savedAmount) || 0), 0);
  const totalTarget = items.reduce((s, g) => s + (Number(g.targetAmount) || 0), 0);
  const overallPct = totalTarget > 0 ? Math.min((totalSaved / totalTarget) * 100, 100) : 0;
  const columns = width >= 1024 ? 3 : width >= 768 ? 2 : 1;

  if (loading) return <GoalsSkeleton />;

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
            Goals
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
            Your financial milestones
          </p>
        </div>
        <Button variant="primary" onClick={openCreate}>
          <Plus size={16} strokeWidth={2} />
          Add Goal
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
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 12,
              marginBottom: 24,
            }}
          >
            <SummaryChip label="Total Goals" value={String(items.length)} color="var(--accent)" />
            <SummaryChip label="Total Saved" value={format(totalSaved)} color="var(--green)" />
            <SummaryChip label="Total Target" value={format(totalTarget)} color="var(--text-primary)" />
          </div>

          {/* Goals grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${columns}, 1fr)`,
              gap: 16,
            }}
          >
            {items.map((goal) => (
              <GoalCard
                key={goal._id}
                goal={goal}
                format={format}
                onAddMoney={() => openContribute(goal)}
                onDelete={() => handleDelete(goal)}
              />
            ))}
          </div>

          {/* Overall progress */}
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
              Overall Progress
            </div>
            <div
              style={{
                height: 12,
                borderRadius: 'var(--radius-full)',
                background: 'var(--bg-elevated)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${overallPct}%`,
                  background: 'var(--green)',
                  borderRadius: 'var(--radius-full)',
                  transition: 'width 800ms var(--ease)',
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--green)' }}>
                {format(totalSaved)} saved
              </span>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-muted)' }}>
                {format(Math.max(totalTarget - totalSaved, 0))} to go
              </span>
            </div>
          </div>
        </>
      )}

      {/* Add goal modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Add Goal">
        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {formError && <FormError>{formError}</FormError>}
          <Input
            label="Goal Name"
            type="text"
            required
            maxLength={100}
            placeholder="e.g. Emergency Fund"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Input
            label="Category"
            type="text"
            placeholder="e.g. Savings, Travel"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          />
          <Input
            label="Target Amount"
            prefix="₹"
            type="number"
            step="0.01"
            min="0.01"
            max="999999999.99"
            required
            value={form.targetAmount}
            onChange={(e) => setForm({ ...form, targetAmount: e.target.value })}
          />
          <Input
            label="Target Date"
            type="date"
            value={form.targetDate}
            onChange={(e) => setForm({ ...form, targetDate: e.target.value })}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" loading={submitting}>
              Save
            </Button>
          </div>
        </form>
      </Modal>

      {/* Add money modal */}
      <Modal
        open={contribOpen}
        onClose={() => setContribOpen(false)}
        title={`Add Money to ${contribTarget?.name ?? ''}`}
      >
        <form onSubmit={handleContribute} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {contribTarget && (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {format(contribTarget.savedAmount)} saved of {format(contribTarget.targetAmount)} target (
              {Math.round(Math.min(Number(contribTarget.progress) || 0, 1) * 100)}%)
            </div>
          )}
          {contribError && <FormError>{contribError}</FormError>}
          <Input
            label="Amount to add"
            prefix="₹"
            type="number"
            step="0.01"
            min="0.01"
            max="999999999.99"
            required
            value={contribAmount}
            onChange={(e) => setContribAmount(e.target.value)}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
            <Button variant="secondary" onClick={() => setContribOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" loading={contribSubmitting}>
              Add Money
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

/* ── Presentational helpers ────────────────────────────────────────────────*/

function GoalCard({ goal, format, onAddMoney, onDelete }) {
  const [hover, setHover] = useState(false);
  const progress = Math.min(Number(goal.progress) || 0, 1);
  const percent = Math.round(progress * 100);
  const complete = percent >= 100;

  const ringColor =
    percent >= 80 ? 'var(--green)' : percent >= 50 ? 'var(--amber)' : 'var(--accent)';
  const offset = RING_CIRC * (1 - Math.min(percent, 100) / 100);

  let overdue = false;
  if (goal.targetDate && !complete) {
    const due = new Date(goal.targetDate);
    if (!Number.isNaN(due.getTime())) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      overdue = due < today;
    }
  }
  const dateText = goal.targetDate
    ? new Date(goal.targetDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
    : null;

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-xl)',
        padding: 24,
        boxShadow: hover ? 'var(--shadow-md)' : 'var(--shadow-sm)',
        transition: 'box-shadow 200ms var(--ease)',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      {/* Top row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {goal.name}
          </div>
          {goal.category && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{goal.category}</div>
          )}
        </div>
        <IconBtn icon={Trash2} label="Delete" danger onClick={onDelete} />
      </div>

      {/* Progress ring */}
      <div style={{ position: 'relative', width: 120, height: 120, margin: '8px auto' }}>
        <svg width="120" height="120" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r={RING_RADIUS} fill="none" stroke="var(--bg-elevated)" strokeWidth="10" />
          <circle
            cx="60"
            cy="60"
            r={RING_RADIUS}
            fill="none"
            stroke={ringColor}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={RING_CIRC}
            strokeDashoffset={offset}
            style={{
              transform: 'rotate(-90deg)',
              transformOrigin: 'center',
              transition: 'stroke-dashoffset 800ms var(--ease)',
            }}
          />
        </svg>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {complete ? (
            <>
              <CheckCircle2 size={32} strokeWidth={2} color="var(--green)" />
              <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 2 }}>Complete!</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>{percent}%</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>complete</div>
            </>
          )}
        </div>
      </div>

      {/* Caption (also satisfies progress read-out) */}
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: -8 }}>
        {percent}% saved
      </div>

      {/* Amount row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--green)' }}>
            {format(goal.savedAmount)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>saved</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 15, fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>
            {format(goal.targetAmount)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>target</div>
        </div>
      </div>

      {/* Target date row */}
      {dateText && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Calendar size={14} strokeWidth={1.75} color={overdue ? 'var(--red)' : 'var(--text-muted)'} />
          <span style={{ fontSize: 12, color: overdue ? 'var(--red)' : 'var(--text-muted)' }}>
            Target: {dateText}
          </span>
          {overdue && <Badge variant="danger">Overdue</Badge>}
        </div>
      )}

      {/* Add money / achieved */}
      <div style={{ marginTop: 'auto' }}>
        {complete ? (
          <Button variant="secondary" fullWidth disabled>
            Goal Achieved! 🎉
          </Button>
        ) : (
          <Button variant="primary" fullWidth onClick={onAddMoney}>
            <Plus size={14} strokeWidth={2} />
            Add Money
          </Button>
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

function FormError({ children }) {
  return (
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
      {children}
    </p>
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
      <Target size={48} strokeWidth={1.5} color="var(--text-muted)" />
      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)', marginTop: 12 }}>
        No goals yet
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
        Set financial goals and track your progress visually
      </div>
      <div style={{ marginTop: 16 }}>
        <Button variant="primary" onClick={onAdd}>
          <Plus size={16} strokeWidth={2} />
          Add Your First Goal
        </Button>
      </div>
    </div>
  );
}
