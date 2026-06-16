import { useState, useMemo } from 'react';
import SliderField from './SliderField';
import {
  CalculatorLayout,
  ResultCard,
  ResultRow,
  SplitBar,
  inr,
} from './shared';

/**
 * SWP (Systematic Withdrawal Plan) calculator.
 * Loop monthly: balance = balance × (1 + r) − withdrawal, r = annualRate/12/100.
 */
export default function SwpCalculator() {
  const [investment, setInvestment] = useState(1000000);
  const [rate, setRate] = useState(8);
  const [withdrawal, setWithdrawal] = useState(10000);
  const [years, setYears] = useState(10);

  const { endingBalance, totalWithdrawn, depleted } = useMemo(() => {
    let balance = Number(investment) || 0;
    const r = (Number(rate) || 0) / 12 / 100;
    const months = (Number(years) || 0) * 12;
    const w = Number(withdrawal) || 0;
    let withdrawn = 0;
    let ranOut = false;
    for (let i = 0; i < months; i += 1) {
      balance = balance * (1 + r);
      if (balance >= w) {
        balance -= w;
        withdrawn += w;
      } else {
        withdrawn += balance;
        balance = 0;
        ranOut = true;
        break;
      }
    }
    return { endingBalance: balance, totalWithdrawn: withdrawn, depleted: ranOut };
  }, [investment, rate, withdrawal, years]);

  return (
    <CalculatorLayout
      controls={
        <>
          <SliderField
            label="Total investment"
            value={investment}
            onChange={setInvestment}
            min={10000}
            max={50000000}
            step={10000}
            prefix="₹"
          />
          <SliderField
            label="Expected return rate (p.a.)"
            value={rate}
            onChange={setRate}
            min={1}
            max={20}
            step={0.5}
            suffix="%"
          />
          <SliderField
            label="Monthly withdrawal"
            value={withdrawal}
            onChange={setWithdrawal}
            min={1000}
            max={500000}
            step={1000}
            prefix="₹"
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
            <ResultRow label="Total investment" value={inr(investment)} />
            <ResultRow
              label="Total withdrawn"
              value={inr(totalWithdrawn)}
              tone="accent"
            />
            <ResultRow
              label="Final balance"
              value={inr(endingBalance)}
              tone={endingBalance > 0 ? 'positive' : 'negative'}
            />
            {depleted && (
              <p className="mt-2 text-xs text-amber-600">
                The corpus runs out before the end of the period.
              </p>
            )}
          </ResultCard>
        </>
      }
      bottomChart={
        <ResultCard title="Withdrawn vs remaining">
          <SplitBar
            data={[
              {
                name: 'Outcome',
                Withdrawn: totalWithdrawn,
                Balance: endingBalance,
              },
            ]}
            bars={[
              { dataKey: 'Withdrawn', name: 'Total withdrawn' },
              { dataKey: 'Balance', name: 'Final balance' },
            ]}
          />
        </ResultCard>
      }
    />
  );
}
