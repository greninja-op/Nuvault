import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'nuvault-theme';

/**
 * Read the persisted theme. Defaults to 'dark' when nothing is stored
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
  return 'dark';
}

/**
 * Apply the theme to <html>: dark = no class, light = `.light` class.
 */
function applyTheme(theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'light') root.classList.add('light');
  else root.classList.remove('light');
}

/**
 * Theme controller. Reads/writes the `nuvault-theme` localStorage key,
 * keeps the `.light` class on <html> in sync, and exposes a toggle.
 *
 * @returns {{ theme: 'dark'|'light', toggleTheme: () => void }}
 */
export default function useTheme() {
  const [theme, setTheme] = useState(readStoredTheme);

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
