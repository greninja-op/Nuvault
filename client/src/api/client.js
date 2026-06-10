import axios from 'axios';
import { clearToken, readToken } from '../auth/storage';
import { SESSION_EXPIRED_EVENT } from '../auth/AuthContext';

/**
 * Configured Axios instance for the Nuvault API.
 *
 * - Base URL comes from `VITE_API_URL`, falling back to `/api` so the
 *   client can be served behind the same origin as the API in production.
 * - Request interceptor attaches the stored JWT as a Bearer token whenever
 *   one exists (Requirement 21.2).
 * - Response interceptor handles `401` by clearing the stored token,
 *   notifying the AuthProvider via a custom event, recording a session
 *   expired flag, and redirecting to `/login` within 2 seconds
 *   (Requirement 21.3).
 */

const baseURL =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) || '/api';

const apiClient = axios.create({
  baseURL,
  timeout: 30000,
});

apiClient.interceptors.request.use(
  (config) => {
    const token = readToken();
    if (token) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

/**
 * Mark the session as expired. Idempotent: clears the token, sets a
 * sessionStorage flag the login view can read, and dispatches the
 * `nuvault:session-expired` event so the AuthProvider drops React state.
 */
function markSessionExpired() {
  clearToken();
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.setItem('nuvault.sessionExpired', '1');
    }
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }
}

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      markSessionExpired();
      // Redirect well within the 2-second bound. Skip when already on /login.
      if (
        typeof window !== 'undefined' &&
        window.location &&
        !String(window.location.pathname || '').startsWith('/login')
      ) {
        window.setTimeout(() => {
          try {
            window.location.assign('/login');
          } catch {
            /* ignore navigation failures (e.g. in tests) */
          }
        }, 50);
      }
    }
    return Promise.reject(error);
  },
);

export { markSessionExpired };
export default apiClient;
