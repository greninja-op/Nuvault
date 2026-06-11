import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import apiClient from '../api/client';
import { formatCurrency } from '../lib/format';

/**
 * Display-currency context (Requirement 19.4).
 *
 * The user's chosen display currency is persisted in local storage under a
 * single key. The default is `INR` per Requirement 19.1. Amounts in the app
 * are stored in the base currency (INR); when the user picks another display
 * currency this context fetches the INR→display rate once (from
 * `GET /api/fx/rate`) and exposes a `format(amount)` helper that converts the
 * base amount and formats it with the right symbol. One rate lookup per
 * currency switch — not one per displayed value.
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

  // The INR→displayCurrency conversion rate, plus whether the last lookup
  // failed (so the UI can flag that amounts are shown in the base currency).
  const [rate, setRate] = useState(1);
  const [rateUnavailable, setRateUnavailable] = useState(false);

  // Fetch the rate whenever the display currency changes. INR (the base)
  // needs no lookup — rate is exactly 1.
  useEffect(() => {
    let cancelled = false;

    if (displayCurrency === DEFAULT_DISPLAY_CURRENCY) {
      setRate(1);
      setRateUnavailable(false);
      return undefined;
    }

    (async () => {
      try {
        const { data } = await apiClient.get('/fx/rate', {
          params: { to: displayCurrency },
        });
        if (cancelled) return;
        const r = Number(data && data.rate);
        setRate(Number.isFinite(r) && r > 0 ? r : 1);
        setRateUnavailable(Boolean(data && data.unavailable));
      } catch {
        if (cancelled) return;
        // Network/auth failure → fall back to base amounts, flagged.
        setRate(1);
        setRateUnavailable(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [displayCurrency]);

  /**
   * Convert a base-currency (INR) amount to the active display currency and
   * format it with the correct symbol. When the display currency is INR (or
   * the rate is unavailable, rate=1) it formats the amount unchanged.
   */
  const format = useCallback(
    (amount) => {
      const n = Number(amount);
      const converted = Number.isFinite(n) ? n * rate : amount;
      return formatCurrency(converted, displayCurrency);
    },
    [rate, displayCurrency],
  );

  const value = useMemo(
    () => ({
      displayCurrency,
      setDisplayCurrency,
      supportedCurrencies: SUPPORTED_CURRENCIES,
      rate,
      rateUnavailable,
      format,
    }),
    [displayCurrency, setDisplayCurrency, rate, rateUnavailable, format],
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
