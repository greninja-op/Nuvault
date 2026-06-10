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
 * SIP (Systematic Investment Plan) calculator.
 * M = P × ((((1+r)^n − 1) / r) × (1+r)), r = annualRate/12/100, n = months.
 */
export default function SipCalculator() {
  const [monthly, setMonthly] = useState(10000);
  const [rate, setRate] = useState(12);
  const [years, setYears] = useState(10);

  const { invested, maturity, returns } = useMemo(() => {
    const P = Number(monthly) || 0;
    const n = (Number(years) || 0) * 12;
    const r = (Number(rate) || 0) / 12 / 100;
    const investedAmt = P * n;
    let M;
    if (r === 0) {
      M = investedAmt;
    } else {
      M = P * (((Math.pow(1 + r, n) - 1) / r) * (1 + r));
    }
    return { invested: investedAmt, maturity: M, returns: M - investedAmt };
  }, [monthly, rate, years]);

  return (
    <CalculatorLayout
      controls={
        <>
          <SliderField
            label="Monthly investment"
            value={monthly}
            onChange={setMonthly}
            min={500}
            max={200000}
            step={500}
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
