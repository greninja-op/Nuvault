import { SkeletonCard, SkeletonText, SkeletonScreen } from '../SkeletonLoader';

/** Mirrors Budgets: header + add button + grid of budget cards. */
export default function BudgetSkeleton() {
  return (
    <SkeletonScreen className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <SkeletonText width="10rem" />
        <SkeletonCard width="9rem" height="44px" />
      </div>

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <li
            key={i}
            className="space-y-3 p-4"
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
            }}
          >
            <SkeletonText width="60%" />
            <SkeletonCard height="8px" className="!rounded-full" />
            <SkeletonText width="80%" />
            <SkeletonText width="40%" />
          </li>
        ))}
      </ul>
    </SkeletonScreen>
  );
}
