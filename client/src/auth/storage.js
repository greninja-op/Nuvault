/**
 * Single-key local-storage adapter for the Nuvault JWT.
 *
 * Per Requirement 21.5, only the JWT is persisted in local storage and only
 * under this single key. No email, name, or other profile data is ever stored.
 */

export const TOKEN_STORAGE_KEY = 'nuvault.token';

/**
 * Read the JWT from local storage.
 *
 * Returns `null` when there is no token, when local storage is unavailable
 * (for example during SSR or when access is blocked), or when the stored
 * value is empty.
 */
export function readToken() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null;
    }
    const value = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Persist the JWT under the single designated key, replacing any prior token.
 * Passing a falsy token clears the key.
 */
export function writeToken(token) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    if (!token) {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    /* swallow storage errors so the UI never crashes */
  }
}

/** Remove the stored token. */
export function clearToken() {
  writeToken(null);
}
