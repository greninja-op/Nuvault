import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

/**
 * Display-currency context (Requirement 19.4).
 *
 * The user's chosen display currency is persisted in local storage under a
 * single key and applied to subsequent currency-aware requests (currently
 * the net worth endpoint). The default is `INR` per Requirement 19.1.
 *
 * Only the codes whitelisted in {@link SUPPORTED_CURRENCIES} are honored.
 * Any unknown stored value falls back to {@link DEFAULT_DISPLAY_CURRENCY}
 * so a tampered-with local-storage value can never poison the request.
 */

export const DISPLAY_CURRENCY_STORAGE_KEY = 'nuvault.displayCurrency';
export const DEFAULT_DISPLAY_CURRENCY = 'INR';
export const SUPPORTED_CURRENCIES = Object.freeze([
  'INR',
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'AUD',
  'CAD',
]);

const CurrencyContext = createContext(null);

function readPersisted() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const stored = window.localStorage.getItem(DISPLAY_CURRENCY_STORAGE_KEY);
    if (typeof stored === 'string' && SUPPORTED_CURRENCIES.includes(stored)) {
      return stored;
    }
    return null;
  } catch {
    return null;
  }
}

function writePersisted(value) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(DISPLAY_CURRENCY_STORAGE_KEY, value);
  } catch {
    /* swallow storage errors */
  }
}

export function CurrencyProvider({ children }) {
  const [displayCurrency, setDisplayCurrencyState] = useState(
    () => readPersisted() ?? DEFAULT_DISPLAY_CURRENCY,
  );

  // Re-hydrate once on mount in case the initial render saw an empty
  // local storage (SSR, Strict Mode double-render edge).
  useEffect(() => {
    const stored = readPersisted();
    if (stored && stored !== displayCurrency) {
      setDisplayCurrencyState(stored);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cross-tab sync: mirror the value from the storage event.
  useEffect(() => {
    function handleStorage(event) {
      if (event.key && event.key !== DISPLAY_CURRENCY_STORAGE_KEY) return;
      const stored = readPersisted();
      setDisplayCurrencyState(stored ?? DEFAULT_DISPLAY_CURRENCY);
    }
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const setDisplayCurrency = useCallback((next) => {
    if (!SUPPORTED_CURRENCIES.includes(next)) return;
    writePersisted(next);
    setDisplayCurrencyState(next);
  }, []);

  const value = useMemo(
    () => ({
      displayCurrency,
      setDisplayCurrency,
      supportedCurrencies: SUPPORTED_CURRENCIES,
    }),
    [displayCurrency, setDisplayCurrency],
  );

  return (
    <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>
  );
}

export function useDisplayCurrency() {
  const ctx = useContext(CurrencyContext);
  if (!ctx) {
    throw new Error('useDisplayCurrency must be used within a CurrencyProvider');
  }
  return ctx;
}

export default CurrencyContext;
