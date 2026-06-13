import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import apiClient from '../api/client';
import { useAuth } from '../auth/AuthContext';
import Field, { inputClass } from '../components/Field';
import { extractError } from '../lib/format';

/**
 * Login view. Submits to `POST /auth/register`-style endpoint
 * `POST /auth/login` and, on success, stores the token + user via the
 * AuthContext and redirects to the originally requested page (or `/`).
 */
export default function Login() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [attemptsRemaining, setAttemptsRemaining] = useState(null);
  const [lockExpiresAt, setLockExpiresAt] = useState(null);

  // If the user lands on /login while already authenticated, send them
  // straight to where they came from (or the dashboard).
  useEffect(() => {
    if (isAuthenticated) {
      const from = location.state?.from?.pathname || '/';
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, location, navigate]);

  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        const flag = window.sessionStorage.getItem('nuvault.sessionExpired');
        if (flag) {
          setSessionExpired(true);
          window.sessionStorage.removeItem('nuvault.sessionExpired');
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setAttemptsRemaining(null);
    setLockExpiresAt(null);
    setSubmitting(true);
    try {
      const { data } = await apiClient.post('/auth/login', { email, password });
      login(data.token, data.user);
      const from = location.state?.from?.pathname || '/';
      navigate(from, { replace: true });
    } catch (err) {
      const resp = err?.response;
      // Feature 6: surface lockout state from the structured API response.
      if (resp?.status === 423) {
        setLockExpiresAt(resp.data?.lockExpiresAt || null);
      } else {
        setError(extractError(err, 'Unable to sign in'));
        if (typeof resp?.data?.attemptsRemaining === 'number') {
          setAttemptsRemaining(resp.data.attemptsRemaining);
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  /** Human-friendly local time for the lock expiry, if known. */
  function lockTimeText() {
    if (!lockExpiresAt) return null;
    const d = new Date(lockExpiresAt);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md space-y-4 rounded-lg border border-slate-200 bg-white p-8 shadow-sm"
      >
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Nuvault</h1>
          <p className="mt-1 text-sm text-slate-600">Sign in to your account.</p>
        </div>

        {sessionExpired && (
          <p
            role="alert"
            className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800"
          >
            Your session has expired. Please log in again.
          </p>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </p>
        )}

        <Field label="Email" htmlFor="login-email">
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Password" htmlFor="login-password">
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            required
            minLength={6}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={inputClass}
          />
        </Field>

        {/* Feature 6: lockout feedback below the password field. */}
        {lockExpiresAt ? (
          <p role="alert" className="text-sm font-medium text-red-600">
            Account locked due to too many failed attempts.
            {lockTimeText() ? ` Try again at ${lockTimeText()}.` : ' Try again later.'}
          </p>
        ) : attemptsRemaining !== null ? (
          <p role="alert" className="text-sm font-medium text-red-600">
            {attemptsRemaining === 0
              ? 'Account locked due to too many failed attempts.'
              : `${attemptsRemaining} attempt${attemptsRemaining === 1 ? '' : 's'} remaining before lockout.`}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-400"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="text-center text-sm text-slate-600">
          Need an account?{' '}
          <Link to="/register" className="text-indigo-600 hover:underline">
            Create one
          </Link>
        </p>
      </form>
    </main>
  );
}
