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
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Finance Calculators</h1>
        <p className="text-sm text-slate-600">
          Plan investments, loans, and taxes with quick, interactive estimates.
        </p>
      </header>

      <nav className="flex flex-wrap gap-2" aria-label="Calculator tabs">
        {TABS.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActive(tab.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      <div>
        <ActiveComponent />
      </div>
    </section>
  );
}
