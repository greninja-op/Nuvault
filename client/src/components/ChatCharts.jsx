import DonutChart from './charts/DonutChart';
import AreaChartCard, { formatRupeeShort } from './charts/AreaChartCard';

/**
 * Renders the `charts` array attached to an AI chart_response inside a chat
 * bubble, using the shared styled chart components:
 *   - pie  → DonutChart (center total + legend)
 *   - line → AreaChartCard (smooth green gradient projection, no card frame)
 */

function rupee(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export default function ChatCharts({ charts }) {
  if (!Array.isArray(charts) || charts.length === 0) return null;

  return (
    <div className="w-full">
      {charts.map((chart, i) => {
        if (!chart || !Array.isArray(chart.data) || chart.data.length === 0) return null;

        if (chart.chartType === 'pie') {
          const total = chart.data.reduce(
            (sum, d) => sum + Number(d.amount != null ? d.amount : 0),
            0,
          );
          return (
            <div key={i} className="mt-3">
              {chart.title && (
                <div className="mb-1 text-xs font-medium text-slate-500">{chart.title}</div>
              )}
              <DonutChart
                data={chart.data}
                centerValue={total > 0 ? formatRupeeShort(total) : undefined}
                centerLabel={total > 0 ? 'Total' : undefined}
                valueFormatter={rupee}
              />
            </div>
          );
        }

        if (chart.chartType === 'line') {
          return (
            <div key={i} className="mt-3">
              {chart.title && (
                <div className="mb-1 text-xs font-medium text-slate-500">{chart.title}</div>
              )}
              <AreaChartCard
                data={chart.data}
                dataKey="amount"
                xKey="year"
                card={false}
                color="#22c55e"
              />
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}
