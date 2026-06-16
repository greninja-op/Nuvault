import { useState, useMemo } from 'react';
import SliderField from './SliderField';
import {
  CalculatorLayout,
  ResultCard,
  ResultRow,
  SplitPie,
  inr,
} from './shared';

const LOCK_IN_YEARS = 15;

/**
 * PPF calculator. 15-year lock-in; year-by-year:
 * balance = (balance + yearly) × (1 + rate/100).
 */
export default function PpfCalculator() {
  const [yearly, setYearly] = useState(150000);
  const [rate, setRate] = useState(7.1);

  const { invested, maturity, interest } = useMemo(() => {
    const P = Number(yearly) || 0;
    const r = (Number(rate) || 0) / 100;
    let balance = 0;
    for (let y = 0; y < LOCK_IN_YEARS; y += 1) {
      balance = (balance + P) * (1 + r);
    }
    const totalInvested = P * LOCK_IN_YEARS;
    return { invested: totalInvested, maturity: balance, interest: balance - totalInvested };
  }, [yearly, rate]);

  return (
    <CalculatorLayout
      controls={
        <>
          <SliderField
            label="Yearly investment"
            value={yearly}
            onChange={setYearly}
            min={500}
            max={150000}
            step={500}
            prefix="₹"
            hint="PPF allows up to ₹1,50,000 per year."
          />
          <SliderField
            label="Interest rate (p.a.)"
            value={rate}
            onChange={setRate}
            min={1}
            max={12}
            step={0.1}
            suffix="%"
          />
          <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Lock-in period is fixed at {LOCK_IN_YEARS} years.
          </div>
        </>
      }
      results={
        <>
          <ResultCard title="Summary">
            <ResultRow label="Total invested" value={inr(invested)} />
            <ResultRow label="Interest earned" value={inr(interest)} tone="positive" />
            <ResultRow label="Maturity value" value={inr(maturity)} tone="accent" />
          </ResultCard>
        </>
      }
      bottomChart={
        <ResultCard title="Invested vs interest">
          <SplitPie
            data={[
              { name: 'Invested', value: invested },
              { name: 'Interest', value: interest },
            ]}
          />
        </ResultCard>
      }
    />
  );
}
