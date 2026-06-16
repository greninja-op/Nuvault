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
 * Goal SIP calculator — inverts the SIP formula to find the monthly
 * investment required to reach a target.
 * P = target / ((((1+r)^n − 1) / r) × (1+r)), r = annualRate/12/100, n = months.
 */
export default function GoalSipCalculator() {
  const [target, setTarget] = useState(5000000);
  const [rate, setRate] = useState(12);
  const [years, setYears] = useState(15);

  const { monthly, invested, returns } = useMemo(() => {
    const FV = Number(target) || 0;
    const n = (Number(years) || 0) * 12;
    const r = (Number(rate) || 0) / 12 / 100;
    let P;
    if (n === 0) {
      P = 0;
    } else if (r === 0) {
      P = FV / n;
    } else {
      const factor = ((Math.pow(1 + r, n) - 1) / r) * (1 + r);
      P = FV / factor;
    }
    const investedAmt = P * n;
    return { monthly: P, invested: investedAmt, returns: FV - investedAmt };
  }, [target, rate, years]);

  return (
    <CalculatorLayout
      controls={
        <>
          <SliderField
            label="Target amount"
            value={target}
            onChange={setTarget}
            min={100000}
            max={100000000}
            step={100000}
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
            <ResultRow
              label="Required monthly SIP"
              value={inr(monthly)}
              tone="accent"
            />
            <ResultRow label="Total invested" value={inr(invested)} />
            <ResultRow label="Est. returns" value={inr(returns)} tone="positive" />
            <ResultRow label="Target value" value={inr(target)} />
          </ResultCard>
        </>
      }
      bottomChart={
        <ResultCard title="Invested vs returns">
          <SplitPie
            data={[
              { name: 'Invested', value: invested },
              { name: 'Returns', value: returns },
            ]}
          />
        </ResultCard>
      }
    />
  );
}
