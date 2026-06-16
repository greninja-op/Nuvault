import { useState } from 'react';
import SipCalculator from '../components/calculators/SipCalculator';
import LumpsumCalculator from '../components/calculators/LumpsumCalculator';
import SwpCalculator from '../components/calculators/SwpCalculator';
import FdCalculator from '../components/calculators/FdCalculator';
import RdCalculator from '../components/calculators/RdCalculator';
import PpfCalculator from '../components/calculators/PpfCalculator';
import EmiCalculator from '../components/calculators/EmiCalculator';
import LoanPrepaymentCalculator from '../components/calculators/LoanPrepaymentCalculator';
import GoalSipCalculator from '../components/calculators/GoalSipCalculator';
import InflationCalculator from '../components/calculators/InflationCalculator';
import TaxCalculator from '../components/calculators/TaxCalculator';
import CagrCalculator from '../components/calculators/CagrCalculator';

/**
 * Finance Calculators page. Presents 12 fully client-side calculators as
 * tabs, defaulting to SIP. Each tab renders a self-contained calculator
 * component with live recalculation and a chart-based breakdown.
 */
const TABS = [
  { id: 'sip', label: 'SIP', Component: SipCalculator },
  { id: 'lumpsum', label: 'Lumpsum', Component: LumpsumCalculator },
  { id: 'swp', label: 'SWP', Component: SwpCalculator },
  { id: 'fd', label: 'FD', Component: FdCalculator },
  { id: 'rd', label: 'RD', Component: RdCalculator },
  { id: 'ppf', label: 'PPF', Component: PpfCalculator },
  { id: 'emi', label: 'EMI', Component: EmiCalculator },
  { id: 'prepayment', label: 'Loan Prepayment', Component: LoanPrepaymentCalculator },
  { id: 'goal-sip', label: 'Goal SIP', Component: GoalSipCalculator },
  { id: 'inflation', label: 'Inflation', Component: InflationCalculator },
  { id: 'tax', label: 'Income Tax', Component: TaxCalculator },
  { id: 'cagr', label: 'CAGR', Component: CagrCalculator },
];

export default function Calculators() {
  const [active, setActive] = useState('sip');
  const ActiveComponent =
    TABS.find((t) => t.id === active)?.Component ?? SipCalculator;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
          Finance Calculators
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 4 }}>
          Run the numbers before you commit.
        </p>
      </div>

      {/* Tab bar — wraps on desktop, horizontal scroll on mobile */}
      <nav
        className="no-scrollbar"
        aria-label="Calculator tabs"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          overflowX: 'auto',
          paddingBottom: 4,
          marginBottom: 24,
        }}
      >
        {TABS.map((tab) => (
          <TabPill key={tab.id} active={tab.id === active} onClick={() => setActive(tab.id)}>
            {tab.label}
          </TabPill>
        ))}
      </nav>

      <div>
        <ActiveComponent />
      </div>
    </div>
  );
}

function TabPill({ active, onClick, children }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-current={active ? 'page' : undefined}
      style={{
        padding: '9px 18px',
        borderRadius: 'var(--radius-full)',
        fontFamily: 'Poppins, system-ui, sans-serif',
        fontSize: 13,
        fontWeight: 500,
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
