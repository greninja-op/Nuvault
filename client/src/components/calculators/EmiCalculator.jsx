import { useState, useMemo } from 'react';
import SliderField from './SliderField';
import {
  CalculatorLayout,
  ResultCard,
  ResultRow,
  SplitPie,
  inr,
} from './shared';
import AreaChartCard from '../charts/AreaChartCard';

/**
 * Loan EMI calculator.
 * EMI = P × r × (1+r)^n / ((1+r)^n − 1), r = annualRate/12/100, n = months.
 */
export default function EmiCalculator() {
  const [loan, setLoan] = useState(1000000);
  const [rate, setRate] = useState(9);
  const [months, setMonths] = useState(60);

  const { emi, totalInterest, totalPayment } = useMemo(() => {
    const P = Number(loan) || 0;
    const r = (Number(rate) || 0) / 12 / 100;
    const n = Number(months) || 0;
    let monthlyEmi;
    if (n === 0) {
      monthlyEmi = 0;
    } else if (r === 0) {
      monthlyEmi = P / n;
    } else {
      monthlyEmi =
        (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    }
    const payment = monthlyEmi * n;
    return {
      emi: monthlyEmi,
      totalInterest: payment - P,
      totalPayment: payment,
    };
  }, [loan, rate, months]);

  const projection = useMemo(() => {
    const P = Number(loan) || 0;
    const r = (Number(rate) || 0) / 12 / 100;
    const n = Number(months) || 0;
    if (n === 0) return [];
    const monthlyEmi = r === 0 ? P / n : (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    const out = [{ label: 'Start', value: P }];
    // Sample the outstanding balance at up to ~12 evenly spaced points.
    const stepCount = Math.min(12, n);
    for (let s = 1; s <= stepCount; s += 1) {
      const k = Math.round((n * s) / stepCount);
      const balance =
        r === 0
          ? Math.max(P - monthlyEmi * k, 0)
          : Math.max(P * Math.pow(1 + r, k) - monthlyEmi * ((Math.pow(1 + r, k) - 1) / r), 0);
      out.push({ label: `M${k}`, value: balance });
    }
    return out;
  }, [loan, rate, months]);

  return (
    <CalculatorLayout
      controls={
        <>
          <SliderField
            label="Loan amount"
            value={loan}
            onChange={setLoan}
            min={10000}
            max={50000000}
            step={10000}
            prefix="₹"
          />
          <SliderField
            label="Interest rate (p.a.)"
            value={rate}
            onChange={setRate}
            min={1}
            max={25}
            step={0.1}
            suffix="%"
          />
          <SliderField
            label="Loan tenure"
            value={months}
            onChange={setMonths}
            min={3}
            max={360}
            step={1}
            suffix="mo"
          />
        </>
      }
      results={
        <>
          <ResultCard title="Summary">
            <ResultRow label="Monthly EMI" value={inr(emi)} tone="accent" />
            <ResultRow label="Principal" value={inr(loan)} />
            <ResultRow label="Total interest" value={inr(totalInterest)} tone="negative" />
            <ResultRow label="Total payment" value={inr(totalPayment)} />
          </ResultCard>
          <ResultCard title="Principal vs interest">
            <SplitPie
              data={[
                { name: 'Principal', value: Number(loan) || 0 },
                { name: 'Interest', value: totalInterest },
              ]}
            />
          </ResultCard>
        </>
      }
      bottomChart={
        projection.length >= 2 ? (
          <ResultCard title="Outstanding balance">
            <AreaChartCard
              data={projection}
              dataKey="value"
              xKey="label"
              height={220}
              color="#ef4444"
              card={false}
            />
          </ResultCard>
        ) : null
      }
    />
  );
}
