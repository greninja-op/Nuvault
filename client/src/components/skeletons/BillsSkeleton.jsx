import { SkeletonCard, SkeletonText, SkeletonScreen } from '../SkeletonLoader';

function BillCardSkeleton() {
  return (
    <li className="space-y-3 rounded-lg border border-l-4 border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <SkeletonText width="50%" />
        <SkeletonCard width="4rem" height="20px" />
      </div>
      <SkeletonCard height="44px" />
    </li>
  );
}

/** Mirrors Bills: Overdue (1) + Upcoming (4) grouped card sections. */
export default function BillsSkeleton() {
  return (
    <SkeletonScreen className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <SkeletonText width="8rem" />
        <SkeletonCard width="9rem" height="44px" />
      </div>

      <div className="space-y-2">
        <SkeletonText width="6rem" />
        <ul className="space-y-3">
          <BillCardSkeleton />
        </ul>
      </div>

      <div className="space-y-2">
        <SkeletonText width="6rem" />
        <ul className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <BillCardSkeleton key={i} />
          ))}
        </ul>
      </div>
    </SkeletonScreen>
  );
}
