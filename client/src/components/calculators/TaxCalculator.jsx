import { useState, useMemo } from 'react';
import SliderField from './SliderField';
import {
  CalculatorLayout,
  ResultCard,
  ResultRow,
  SplitBar,
  inr,
} from './shared';

const STANDARD_DEDUCTION = 50000;
const CESS = 0.04;

/** Apply a progressive slab table to a taxable income. */
function slabTax(income, slabs) {
  let tax = 0;
  let lower = 0;
  for (const { upto, rate } of slabs) {
    const cap = upto ?? Infinity;
    if (income > lower) {
      const taxable = Math.min(income, cap) - lower;
      tax += taxable * rate;
      lower = cap;
    } else {
      break;
    }
  }
  return tax;
}

const OLD_SLABS = [
  { upto: 250000, rate: 0 },
  { upto: 500000, rate: 0.05 },
  { upto: 1000000, rate: 0.2 },
  { upto: null, rate: 0.3 },
];

const NEW_SLABS = [
  { upto: 300000, rate: 0 },
  { upto: 600000, rate: 0.05 },
  { upto: 900000, rate: 0.1 },
  { upto: 1200000, rate: 0.15 },
  { upto: 1500000, rate: 0.2 },
  { upto: null, rate: 0.3 },
];

/**
 * Income tax calculator comparing the OLD and NEW regimes (FY 2023-24).
 * Estimate only — does not cover every exemption, surcharge, or edge case.
 */
export default function TaxCalculator() {
  const [income, setIncome] = useState(1200000);
  const [section80c, setSection80c] = useState(150000);

  const { oldTax, newTax, oldTaxable, newTaxable } = useMemo(() => {
    const gross = Number(income) || 0;

    // OLD regime: standard deduction + 80C (capped at 1,50,000).
    const ded80c = Math.min(Number(section80c) || 0, 150000);
    const oldTaxableIncome = Math.max(0, gross - STANDARD_DEDUCTION - ded80c);
    let oldBase = slabTax(oldTaxableIncome, OLD_SLABS);
    if (oldTaxableIncome <= 500000) oldBase = 0; // 87A rebate
    const oldTotal = oldBase * (1 + CESS);

    // NEW regime: standard deduction only.
    const newTaxableIncome = Math.max(0, gross - STANDARD_DEDUCTION);
    let newBase = slabTax(newTaxableIncome, NEW_SLABS);
    if (newTaxableIncome <= 700000) newBase = 0; // 87A rebate
    const newTotal = newBase * (1 + CESS);

    return {
      oldTax: oldTotal,
      newTax: newTotal,
      oldTaxable: oldTaxableIncome,
      newTaxable: newTaxableIncome,
    };
  }, [income, section80c]);

  const cheaper = oldTax === newTax ? 'either' : oldTax < newTax ? 'old' : 'new';

  return (
    <CalculatorLayout
      controls={
        <>
          <SliderField
            label="Annual income"
            value={income}
            onChange={setIncome}
            min={250000}
            max={10000000}
            step={50000}
            prefix="₹"
          />
          <SliderField
            label="80C deductions (old regime)"
            value={section80c}
            onChange={setSection80c}
            min={0}
            max={150000}
            step={5000}
            prefix="₹"
            hint="Capped at ₹1,50,000. Standard deduction of ₹50,000 is applied automatically to both regimes."
          />
        </>
      }
      results={
        <>
          <ResultCard title="Comparison">
            <ResultRow label="Taxable income (old)" value={inr(oldTaxable)} />
            <ResultRow
              label="Tax — Old regime"
              value={inr(oldTax)}
              tone={cheaper === 'old' ? 'positive' : 'neutral'}
            />
            <ResultRow label="Taxable income (new)" value={inr(newTaxable)} />
            <ResultRow
              label="Tax — New regime"
              value={inr(newTax)}
              tone={cheaper === 'new' ? 'positive' : 'neutral'}
            />
            <ResultRow
              label="You save"
              value={inr(Math.abs(oldTax - newTax))}
              tone="accent"
            />
            <p className="mt-2 text-sm font-medium text-slate-700">
              {cheaper === 'either'
                ? 'Both regimes cost the same.'
                : `The ${cheaper === 'old' ? 'Old' : 'New'} regime is cheaper for you.`}
            </p>
          </ResultCard>
        </>
      }
      bottomChart={
        <ResultCard title="Old vs new regime">
          <SplitBar
            data={[
              { name: 'Old', Tax: oldTax },
              { name: 'New', Tax: newTax },
            ]}
            bars={[{ dataKey: 'Tax', name: 'Tax payable' }]}
          />
          <p className="mt-3 text-xs text-slate-500">
            This is a simplified estimate (incl. 4% cess and Section 87A
            rebate) for FY 2023-24. It does not account for surcharge, HRA,
            or other exemptions. Consult a tax professional for filing.
          </p>
        </ResultCard>
      }
    />
  );
}
