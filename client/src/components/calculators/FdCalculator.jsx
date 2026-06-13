import { useState, useMemo } from 'react';
import SliderField from './SliderField';
import {
  CalculatorLayout,
  ResultCard,
  ResultRow,
  SplitPie,
  inr,
} from './shared';
import { inputClass } from '../Field';
import AreaChartCard from '../charts/AreaChartCard';

const COMPOUNDING = {
  monthly: { label: 'Monthly', n: 12 },
  quarterly: { label: 'Quarterly', n: 4 },
  yearly: { label: 'Yearly', n: 1 },
};

/**
 * Fixed Deposit calculator. A = P × (1 + (r/100)/n)^(n × years).
 */
export default function FdCalculator() {
  const [principal, setPrincipal] = useState(100000);
  const [rate, setRate] = useState(7);
  const [years, setYears] = useState(5);
  const [freq, setFreq] = useState('quarterly');

  const { invested, maturity, interest } = useMemo(() => {
    const P = Number(principal) || 0;
    const r = (Number(rate) || 0) / 100;
    const n = COMPOUNDING[freq].n;
    const t = Number(years) || 0;
    const A = P * Math.pow(1 + r / n, n * t);
    return { invested: P, maturity: A, interest: A - P };
  }, [principal, rate, years, freq]);

  const projection = useMemo(() => {
    const P = Number(principal) || 0;
    const r = (Number(rate) || 0) / 100;
    const n = COMPOUNDING[freq].n;
    const totalYears = Number(years) || 0;
    const out = [];
    for (let y = 1; y <= totalYears; y += 1) {
      out.push({ label: `Yr ${y}`, value: P * Math.pow(1 + r / n, n * y) });
    }
    return out;
  }, [principal, rate, years, freq]);

  return (
    <CalculatorLayout
      controls={
        <>
          <SliderField
            label="Principal amount"
            value={principal}
            onChange={setPrincipal}
            min={1000}
            max={10000000}
            step={1000}
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
            label="Time period"
            value={years}
            onChange={setYears}
            min={1}
            max={20}
            step={1}
            suffix="yr"
          />
          <div className="space-y-1">
            <span className="text-sm font-medium text-slate-700">Compounding</span>
            <select
              value={freq}
              onChange={(e) => setFreq(e.target.value)}
              className={inputClass}
            >
              {Object.entries(COMPOUNDING).map(([key, { label }]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </>
      }
      results={
        <>
          <ResultCard title="Summary">
            <ResultRow label="Principal" value={inr(invested)} />
            <ResultRow label="Interest earned" value={inr(interest)} tone="positive" />
            <ResultRow label="Maturity value" value={inr(maturity)} tone="accent" />
          </ResultCard>
          <ResultCard title="Principal vs interest">
            <SplitPie
              data={[
                { name: 'Principal', value: invested },
                { name: 'Interest', value: interest },
              ]}
            />
          </ResultCard>
          {projection.length >= 2 && (
            <ResultCard title="Maturity growth">
              <AreaChartCard
                data={projection}
                dataKey="value"
                xKey="label"
                height={220}
                card={false}
              />
            </ResultCard>
          )}
        </>
      }
    />
  );
}
