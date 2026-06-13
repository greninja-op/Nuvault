import { SkeletonCard, SkeletonText, SkeletonScreen } from '../SkeletonLoader';

/** Mirrors Dashboard: 3 summary cards + 2 breakdown panels. */
export default function DashboardSkeleton() {
  return (
    <SkeletonScreen className="space-y-6">
      <div className="space-y-2">
        <SkeletonText width="12rem" />
        <SkeletonText width="20rem" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <SkeletonCard key={i} height="120px" />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {[0, 1].map((col) => (
          <div
            key={col}
            className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
          >
            <SkeletonText width="8rem" />
            {[0, 1, 2, 3].map((row) => (
              <SkeletonText key={row} />
            ))}
          </div>
        ))}
      </div>
    </SkeletonScreen>
  );
}
