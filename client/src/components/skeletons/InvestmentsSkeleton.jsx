import { SkeletonCard, SkeletonText, SkeletonScreen } from '../SkeletonLoader';

/** Mirrors Investments: 3 summary cards + table header + rows. */
export default function InvestmentsSkeleton() {
  return (
    <SkeletonScreen className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <SkeletonText width="10rem" />
        <SkeletonCard width="9rem" height="40px" />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <SkeletonCard key={i} height="100px" />
        ))}
      </div>

      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex gap-4">
          {[0, 1, 2, 3].map((i) => (
            <SkeletonText key={i} width="25%" />
          ))}
        </div>
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <div key={row} className="flex gap-4">
            {[0, 1, 2, 3].map((cell) => (
              <SkeletonText key={cell} width="25%" />
            ))}
          </div>
        ))}
      </div>
    </SkeletonScreen>
  );
}
