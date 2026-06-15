import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'nuvault-theme';

/**
 * Read the persisted theme. Defaults to 'light' when nothing is stored
 * (or when localStorage is unavailable, e.g. SSR / tests).
 */
function readStoredTheme() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === 'light' || stored === 'dark') return stored;
    }
  } catch {
    /* ignore */
  }
  return 'light';
}

/**
 * Apply the theme to <html>: light = no class (bare :root tokens),
 * dark = `.dark` class.
 */
function applyTheme(theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  // `.light` is never used now; clear it defensively in case an older build
  // left it on the element.
  root.classList.remove('light');
  if (theme === 'dark') root.classList.add('dark');
  else root.classList.remove('dark');
}

/**
 * Theme controller. Reads/writes the `nuvault-theme` localStorage key,
 * keeps the `.dark` class on <html> in sync, and exposes a toggle. Light is
 * the default; dark remains available via toggle.
 *
 * @returns {{ theme: 'light'|'dark', toggleTheme: () => void }}
 */
export default function useTheme() {
  const [theme, setTheme] = useState(readStoredTheme);

  // Persist a default of 'light' for returning users who never chose a theme.
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        if (!window.localStorage.getItem(STORAGE_KEY)) {
          window.localStorage.setItem(STORAGE_KEY, 'light');
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Keep the document class in sync whenever the theme changes (and on mount).
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(STORAGE_KEY, next);
        }
      } catch {
        /* ignore */
      }
      applyTheme(next);
      return next;
    });
  }, []);

  return { theme, toggleTheme };
}
