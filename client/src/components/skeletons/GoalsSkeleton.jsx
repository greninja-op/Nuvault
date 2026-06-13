import { SkeletonCard, SkeletonText, SkeletonScreen } from '../SkeletonLoader';

/** Mirrors Goals: header + add button + grid of goal cards. */
export default function GoalsSkeleton() {
  return (
    <SkeletonScreen className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <SkeletonText width="8rem" />
        <SkeletonCard width="9rem" height="44px" />
      </div>

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3].map((i) => (
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
            <SkeletonCard height="60px" />
            <SkeletonText width="80%" />
            <SkeletonText width="40%" />
          </li>
        ))}
      </ul>
    </SkeletonScreen>
  );
}
