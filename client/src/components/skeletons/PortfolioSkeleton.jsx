import { SkeletonCard, SkeletonText, SkeletonScreen } from '../SkeletonLoader';

/** Mirrors Portfolio: 3 summary cards + allocation chart + sections. */
export default function PortfolioSkeleton() {
  return (
    <SkeletonScreen className="space-y-6">
      <SkeletonText width="10rem" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <SkeletonCard key={i} height="100px" />
        ))}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <SkeletonText width="10rem" className="mb-3" />
        <SkeletonCard height="200px" />
      </div>

      <div className="space-y-6">
        {[0, 1, 2].map((section) => (
          <div
            key={section}
            className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
          >
            <SkeletonText width="8rem" />
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex items-center justify-between gap-3">
                <SkeletonText width="40%" />
                <SkeletonText width="20%" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </SkeletonScreen>
  );
}
