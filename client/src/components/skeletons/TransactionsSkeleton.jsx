import { SkeletonCard, SkeletonText, SkeletonCircle, SkeletonScreen } from '../SkeletonLoader';

/** Mirrors Transactions: header + filter row + list of rows. */
export default function TransactionsSkeleton() {
  return (
    <SkeletonScreen className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <SkeletonText width="12rem" />
        <SkeletonCard width="9rem" height="44px" />
      </div>

      <div className="flex gap-3">
        {[0, 1, 2].map((i) => (
          <SkeletonCard key={i} width="8rem" height="40px" />
        ))}
      </div>

      <div
        className="space-y-2 p-3"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
        }}
      >
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div key={i} className="flex items-center gap-3 py-2">
            <SkeletonCircle size={32} />
            <div className="flex-1 space-y-2">
              <SkeletonText width="40%" />
              <SkeletonText width="60%" />
            </div>
            <SkeletonCard width="5rem" height="24px" />
          </div>
        ))}
      </div>
    </SkeletonScreen>
  );
}
