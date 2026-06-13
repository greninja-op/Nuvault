import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement matchMedia / ResizeObserver. A couple of UI
// components (responsive hooks, charts) reference them, so provide minimal
// no-op polyfills for the test environment.
if (typeof window !== 'undefined') {
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  }

  if (typeof window.ResizeObserver !== 'function') {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    globalThis.ResizeObserver = window.ResizeObserver;
  }
}
