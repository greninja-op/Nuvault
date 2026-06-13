import { useEffect, useState } from 'react';

const MOBILE_BREAKPOINT = 768;

/**
 * Track viewport width and expose `isMobile` (< 768px). SSR/test-safe: starts
 * from a sensible default when `window` is unavailable and updates on resize.
 *
 * @returns {{ width: number, isMobile: boolean }}
 */
export default function useWindowSize() {
  const getWidth = () =>
    typeof window !== 'undefined' && typeof window.innerWidth === 'number'
      ? window.innerWidth
      : 1024;

  const [width, setWidth] = useState(getWidth);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return { width, isMobile: width < MOBILE_BREAKPOINT };
}
