import { useState, useMemo } from 'react';
import SliderField from './SliderField';
import {
  CalculatorLayout,
  ResultCard,
  ResultRow,
  SplitPie,
  inr,
} from './shared';

/**
 * Recurring Deposit calculator. Each monthly deposit is compounded quarterly:
 * M = Σ P × (1 + r/400)^((months − i + 1) / 3), i = 1..months.
 */
export default function RdCalculator() {
  const [deposit, setDeposit] = useState(5000);
  const [rate, setRate] = useState(7);
  const [months, setMonths] = useState(24);

  const { deposited, maturity, interest } = useMemo(() => {
    const P = Number(deposit) || 0;
    const n = Number(months) || 0;
    const q = (Number(rate) || 0) / 400; // quarterly rate fraction
    let M = 0;
    for (let i = 1; i <= n; i += 1) {
      const quarters = (n - i + 1) / 3;
      M += P * Math.pow(1 + q, quarters);
    }
    const totalDeposited = P * n;
    return { deposited: totalDeposited, maturity: M, interest: M - totalDeposited };
  }, [deposit, rate, months]);

  return (
    <CalculatorLayout
      controls={
        <>
          <SliderField
            label="Monthly deposit"
            value={deposit}
            onChange={setDeposit}
            min={500}
            max={200000}
            step={500}
            prefix="₹"
          />
          <SliderField
            label="Interest rate (p.a.)"
            value={rate}
            onChange={setRate}
            min={1}
            max={15}
            step={0.1}
            suffix="%"
          />
          <SliderField
            label="Tenure"
            value={months}
            onChange={setMonths}
            min={3}
            max={120}
            step={1}
            suffix="mo"
          />
        </>
      }
      results={
        <>
          <ResultCard title="Summary">
            <ResultRow label="Total deposited" value={inr(deposited)} />
            <ResultRow label="Interest earned" value={inr(interest)} tone="positive" />
            <ResultRow label="Maturity value" value={inr(maturity)} tone="accent" />
          </ResultCard>
          <ResultCard title="Deposited vs interest">
            <SplitPie
              data={[
                { name: 'Deposited', value: deposited },
                { name: 'Interest', value: interest },
              ]}
            />
          </ResultCard>
        </>
      }
    />
  );
}
