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
 * CAGR calculator. CAGR = (final/initial)^(1/years) − 1, shown as %.
 */
export default function CagrCalculator() {
  const [initial, setInitial] = useState(100000);
  const [final, setFinal] = useState(250000);
  const [years, setYears] = useState(5);

  const { cagr, absoluteReturn, gain } = useMemo(() => {
    const P = Number(initial) || 0;
    const F = Number(final) || 0;
    const t = Number(years) || 0;
    let rate = 0;
    if (P > 0 && t > 0) {
      rate = (Math.pow(F / P, 1 / t) - 1) * 100;
    }
    const abs = P > 0 ? ((F - P) / P) * 100 : 0;
    return { cagr: rate, absoluteReturn: abs, gain: F - P };
  }, [initial, final, years]);

  return (
    <CalculatorLayout
      controls={
        <>
          <SliderField
            label="Initial value"
            value={initial}
            onChange={setInitial}
            min={1000}
            max={50000000}
            step={1000}
            prefix="₹"
          />
          <SliderField
            label="Final value"
            value={final}
            onChange={setFinal}
            min={1000}
            max={100000000}
            step={1000}
            prefix="₹"
          />
          <SliderField
            label="Duration"
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
              label="CAGR"
              value={`${cagr.toFixed(2)}%`}
              tone={cagr >= 0 ? 'positive' : 'negative'}
            />
            <ResultRow label="Absolute return" value={`${absoluteReturn.toFixed(2)}%`} />
            <ResultRow
              label="Total gain"
              value={inr(gain)}
              tone={gain >= 0 ? 'positive' : 'negative'}
            />
          </ResultCard>
        </>
      }
      bottomChart={
        <ResultCard title="Initial vs final">
          <SplitBar
            data={[
              {
                name: 'Value',
                Initial: Number(initial) || 0,
                Final: Number(final) || 0,
              },
            ]}
            bars={[
              { dataKey: 'Initial', name: 'Initial value' },
              { dataKey: 'Final', name: 'Final value' },
            ]}
          />
        </ResultCard>
      }
    />
  );
}
