import { useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import useWindowSize from '../hooks/useWindowSize';

/**
 * Slide-and-fade transition between routes, applied on mobile only. On
 * desktop the children render directly (no motion wrapper).
 *
 * Direction is inferred from each route's position in NAV_ORDER: navigating
 * "forward" (to a later entry) slides left, "back" slides right.
 *
 * NAV_ORDER uses Nuvault's real route paths (the spec's sample list referenced
 * a few routes that don't exist here, e.g. /networth and /ai-advisor).
 */
const NAV_ORDER = [
  '/',
  '/transactions',
  '/budgets',
  '/assets',
  '/liabilities',
  '/portfolio',
  '/investments',
  '/goals',
  '/bills',
  '/calculators',
  '/chat',
  '/settings',
];

const variants = {
  enter: (dir) => ({ x: dir > 0 ? 50 : -50, opacity: 0 }),
  center: {
    x: 0,
    opacity: 1,
    transition: { duration: 0.25, ease: [0.4, 0, 0.2, 1] },
  },
  exit: (dir) => ({
    x: dir > 0 ? -50 : 50,
    opacity: 0,
    transition: { duration: 0.2, ease: [0.4, 0, 0.2, 1] },
  }),
};

export default function PageTransition({ children }) {
  const location = useLocation();
  const { isMobile } = useWindowSize();
  const prevPathRef = useRef(location.pathname);

  const currentIndex = NAV_ORDER.indexOf(location.pathname);
  const prevIndex = NAV_ORDER.indexOf(prevPathRef.current);
  const direction = currentIndex > prevIndex ? 1 : -1;
  prevPathRef.current = location.pathname;

  // Desktop: render directly, no animation.
  if (!isMobile) return children;

  return (
    <AnimatePresence mode="wait" custom={direction}>
      <motion.div
        key={location.pathname}
        custom={direction}
        variants={variants}
        initial="enter"
        animate="center"
        exit="exit"
        style={{ width: '100%' }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
