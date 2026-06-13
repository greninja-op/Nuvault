import { SkeletonCard, SkeletonText, SkeletonScreen } from '../SkeletonLoader';

/** Mirrors AI Advisor: alternating chat bubbles + input bar. */
export default function AiAdvisorSkeleton() {
  return (
    <SkeletonScreen className="flex h-[calc(100dvh-11rem)] flex-col md:h-[70vh]">
      <SkeletonText width="10rem" className="mb-4 shrink-0" />

      <div
        className="flex-1 space-y-4 overflow-hidden p-4"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
        }}
      >
        <div className="flex justify-start">
          <SkeletonCard width="60%" height="48px" />
        </div>
        <div className="flex justify-end">
          <SkeletonCard width="80%" height="64px" />
        </div>
        <div className="flex justify-start">
          <SkeletonCard width="70%" height="56px" />
        </div>
      </div>

      <div className="mt-3 shrink-0">
        <SkeletonCard height="44px" />
      </div>
    </SkeletonScreen>
  );
}
