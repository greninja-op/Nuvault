import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import apiClient from '../api/client';
import { useAuth } from '../auth/AuthContext';
import Field, { inputClass } from '../components/Field';
import { extractError } from '../lib/format';

/**
 * Registration view. POSTs to `/auth/register` and, on success, stores
 * the returned token + user via the AuthContext and lands the user on
 * the dashboard.
 */
export default function Register() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isAuthenticated) navigate('/', { replace: true });
  }, [isAuthenticated, navigate]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const { data } = await apiClient.post('/auth/register', {
        name,
        email,
        password,
      });
      login(data.token, data.user);
      navigate('/', { replace: true });
    } catch (err) {
      setError(extractError(err, 'Unable to create your account'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md space-y-4 rounded-lg border border-slate-200 bg-white p-8 shadow-sm"
      >
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Create your account</h1>
          <p className="mt-1 text-sm text-slate-600">
            Start tracking your finances in a few seconds.
          </p>
        </div>

        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <Field label="Name" htmlFor="register-name">
          <input
            id="register-name"
            type="text"
            autoComplete="name"
            required
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Email" htmlFor="register-email">
          <input
            id="register-email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputClass}
          />
        </Field>

        <Field
          label="Password"
          htmlFor="register-password"
          hint="6 to 128 characters."
        >
          <input
            id="register-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={6}
            maxLength={128}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={inputClass}
          />
        </Field>

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-400"
        >
          {submitting ? 'Creating account…' : 'Create account'}
        </button>

        <p className="text-center text-sm text-slate-600">
          Already have an account?{' '}
          <Link to="/login" className="text-indigo-600 hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </main>
  );
}
