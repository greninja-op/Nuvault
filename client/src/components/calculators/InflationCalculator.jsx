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
 * Inflation calculator. FV = PV × (1 + rate/100)^years.
 * Also shows the future purchasing power of today's money.
 */
export default function InflationCalculator() {
  const [present, setPresent] = useState(100000);
  const [rate, setRate] = useState(6);
  const [years, setYears] = useState(10);

  const { futureValue, purchasingPower, erosion } = useMemo(() => {
    const PV = Number(present) || 0;
    const factor = Math.pow(1 + (Number(rate) || 0) / 100, Number(years) || 0);
    const FV = PV * factor;
    const power = factor === 0 ? 0 : PV / factor;
    return { futureValue: FV, purchasingPower: power, erosion: PV - power };
  }, [present, rate, years]);

  return (
    <CalculatorLayout
      controls={
        <>
          <SliderField
            label="Present value"
            value={present}
            onChange={setPresent}
            min={1000}
            max={100000000}
            step={1000}
            prefix="₹"
          />
          <SliderField
            label="Inflation rate (p.a.)"
            value={rate}
            onChange={setRate}
            min={1}
            max={20}
            step={0.1}
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
            <ResultRow label="Present value" value={inr(present)} />
            <ResultRow
              label="Cost in the future"
              value={inr(futureValue)}
              tone="negative"
            />
            <ResultRow
              label="Future purchasing power of today's money"
              value={inr(purchasingPower)}
              tone="accent"
            />
            <ResultRow label="Value eroded" value={inr(erosion)} tone="negative" />
          </ResultCard>
        </>
      }
      bottomChart={
        <ResultCard title="Today vs future">
          <SplitBar
            data={[
              {
                name: 'Value',
                Today: Number(present) || 0,
                FutureCost: futureValue,
                Power: purchasingPower,
              },
            ]}
            bars={[
              { dataKey: 'Today', name: 'Today' },
              { dataKey: 'FutureCost', name: 'Future cost' },
              { dataKey: 'Power', name: 'Future power' },
            ]}
          />
        </ResultCard>
      }
    />
  );
}
