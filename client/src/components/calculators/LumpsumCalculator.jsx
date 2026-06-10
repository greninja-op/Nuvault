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
 * Lumpsum investment calculator. A = P × (1 + rate/100)^years.
 */
export default function LumpsumCalculator() {
  const [principal, setPrincipal] = useState(100000);
  const [rate, setRate] = useState(12);
  const [years, setYears] = useState(10);

  const { invested, maturity, returns } = useMemo(() => {
    const P = Number(principal) || 0;
    const A = P * Math.pow(1 + (Number(rate) || 0) / 100, Number(years) || 0);
    return { invested: P, maturity: A, returns: A - P };
  }, [principal, rate, years]);

  return (
    <CalculatorLayout
      controls={
        <>
          <SliderField
            label="Total investment"
            value={principal}
            onChange={setPrincipal}
            min={1000}
            max={10000000}
            step={1000}
            prefix="₹"
          />
          <SliderField
            label="Expected return rate (p.a.)"
            value={rate}
            onChange={setRate}
            min={1}
            max={30}
            step={0.5}
            suffix="%"
          />
          <SliderField
            label="Time period"
            value={years}
            onChange={setYears}
            min={1}
            max={40}
            step={1}
            suffix="yr"
          />
        </>
      }
      results={
        <>
          <ResultCard title="Summary">
            <ResultRow label="Invested amount" value={inr(invested)} />
            <ResultRow label="Est. returns" value={inr(returns)} tone="positive" />
            <ResultRow label="Total value" value={inr(maturity)} tone="accent" />
          </ResultCard>
          <ResultCard title="Invested vs returns">
            <SplitPie
              data={[
                { name: 'Invested', value: invested },
                { name: 'Returns', value: returns },
              ]}
            />
          </ResultCard>
        </>
      }
    />
  );
}
