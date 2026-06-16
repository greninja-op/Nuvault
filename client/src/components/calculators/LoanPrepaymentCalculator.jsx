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
 * Loan prepayment calculator. Computes the EMI on the original loan, then
 * applies a one-time lump-sum prepayment up front and re-amortises at the
 * same EMI to find the interest saved and tenure reduced.
 */
export default function LoanPrepaymentCalculator() {
  const [loan, setLoan] = useState(2000000);
  const [rate, setRate] = useState(9);
  const [months, setMonths] = useState(120);
  const [prepayment, setPrepayment] = useState(200000);

  const result = useMemo(() => {
    const P = Number(loan) || 0;
    const r = (Number(rate) || 0) / 12 / 100;
    const n = Number(months) || 0;
    const prepay = Math.min(Number(prepayment) || 0, P);

    const emi =
      n === 0
        ? 0
        : r === 0
          ? P / n
          : (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);

    // Interest without prepayment.
    const interestWithout = emi * n - P;

    // Re-amortise with the lump sum removed up front, same EMI.
    let balance = P - prepay;
    let interestWith = 0;
    let monthsWith = 0;
    const cap = n + 12; // safety cap
    while (balance > 0 && monthsWith < cap) {
      const interestPart = balance * r;
      let principalPart = emi - interestPart;
      if (principalPart <= 0) break; // EMI can't cover interest
      if (principalPart > balance) principalPart = balance;
      interestWith += interestPart;
      balance -= principalPart;
      monthsWith += 1;
    }

    return {
      emi,
      interestWithout,
      interestWith,
      interestSaved: interestWithout - interestWith,
      monthsSaved: n - monthsWith,
      newTenure: monthsWith,
    };
  }, [loan, rate, months, prepayment]);

  return (
    <CalculatorLayout
      controls={
        <>
          <SliderField
            label="Loan amount"
            value={loan}
            onChange={setLoan}
            min={50000}
            max={50000000}
            step={50000}
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
            min={6}
            max={360}
            step={1}
            suffix="mo"
          />
          <SliderField
            label="Prepayment (one-time)"
            value={prepayment}
            onChange={setPrepayment}
            min={0}
            max={5000000}
            step={10000}
            prefix="₹"
          />
        </>
      }
      results={
        <>
          <ResultCard title="Summary">
            <ResultRow label="Monthly EMI" value={inr(result.emi)} />
            <ResultRow
              label="Interest without prepayment"
              value={inr(result.interestWithout)}
            />
            <ResultRow
              label="Interest with prepayment"
              value={inr(result.interestWith)}
            />
            <ResultRow
              label="Interest saved"
              value={inr(result.interestSaved)}
              tone="positive"
            />
            <ResultRow
              label="Tenure reduced"
              value={`${result.monthsSaved} mo (now ${result.newTenure} mo)`}
              tone="accent"
            />
          </ResultCard>
        </>
      }
      bottomChart={
        <ResultCard title="Interest comparison">
          <SplitBar
            data={[
              {
                name: 'Interest',
                Without: result.interestWithout,
                With: result.interestWith,
              },
            ]}
            bars={[
              { dataKey: 'Without', name: 'Without prepayment' },
              { dataKey: 'With', name: 'With prepayment' },
            ]}
          />
        </ResultCard>
      }
    />
  );
}
