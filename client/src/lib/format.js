/**
 * Currency / number formatting helpers used across feature views.
 */

/**
 * Format a numeric amount using the browser's `Intl.NumberFormat` with
 * the given ISO currency code. Falls back to a fixed-2dp string with a
 * suffixed code when `Intl` is unavailable or rejects the code.
 */
export function formatCurrency(amount, currency = 'INR') {
  const value = Number(amount);
  if (!Number.isFinite(value)) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

/** Format an ISO date string as a short locale date. */
export function formatDate(input) {
  if (!input) return '';
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString();
}

/** Round a number to 2 decimal places. */
export function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Pull a human-readable error message out of an Axios error (or any
 * thrown value). Backend errors are uniformly `{ message }`.
 */
export function extractError(err, fallback = 'Something went wrong') {
  if (!err) return fallback;
  const data = err.response?.data;
  if (data && typeof data.message === 'string' && data.message.length > 0) {
    return data.message;
  }
  if (typeof err.message === 'string' && err.message.length > 0) {
    return err.message;
  }
  return fallback;
}
