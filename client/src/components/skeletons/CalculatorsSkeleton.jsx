import { SkeletonCard, SkeletonText, SkeletonScreen } from '../SkeletonLoader';

/** Mirrors Calculators: tab row + two-column controls/results. */
export default function CalculatorsSkeleton() {
  return (
    <SkeletonScreen className="space-y-6">
      <SkeletonText width="14rem" />

      {/* Tab row */}
      <div className="flex flex-wrap gap-2">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <SkeletonCard key={i} width="5rem" height="36px" />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          {[0, 1, 2, 3].map((i) => (
            <SkeletonCard key={i} height="48px" />
          ))}
        </div>
        <div className="space-y-5">
          <SkeletonCard height="200px" />
        </div>
      </div>
    </SkeletonScreen>
  );
}
