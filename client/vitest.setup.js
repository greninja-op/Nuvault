import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement these browser APIs that boneyard-js's <Skeleton>
// relies on (dark-mode detection via matchMedia, container sizing via
// ResizeObserver). Provide minimal no-op polyfills so wrapped pages render
// in the test environment.
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
