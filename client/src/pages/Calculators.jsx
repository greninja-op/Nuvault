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
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Finance Calculators</h1>
        <p className="text-sm text-slate-600">
          Plan investments, loans, and taxes with quick, interactive estimates.
        </p>
      </header>

      {/* Mobile: dropdown selector */}
      <div className="md:hidden">
        <label htmlFor="calc-select" className="sr-only">
          Choose a calculator
        </label>
        <select
          id="calc-select"
          value={active}
          onChange={(e) => setActive(e.target.value)}
          className="block min-h-[44px] w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          {TABS.map((tab) => (
            <option key={tab.id} value={tab.id}>
              {tab.label}
            </option>
          ))}
        </select>
      </div>

      {/* Tablet+: button tabs */}
      <nav className="hidden flex-wrap gap-2 md:flex" aria-label="Calculator tabs">
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
