import { useEffect, useState } from 'react';
import apiClient from '../api/client';
import { useAuth } from '../auth/AuthContext';
import {
  SUPPORTED_CURRENCIES,
  useDisplayCurrency,
} from '../currency/CurrencyContext';
import { extractError } from '../lib/format';

/**
 * Settings view. Lets the user pick a display currency (persisted in
 * local storage and applied thereafter — Requirement 19.4) and shows
 * the current profile pulled from `GET /auth/me`.
 */
export default function Settings() {
  const { displayCurrency, setDisplayCurrency } = useDisplayCurrency();
  const { user } = useAuth();
  const [profile, setProfile] = useState(user ?? null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function loadMe() {
      try {
        const { data } = await apiClient.get('/auth/me');
        if (!cancelled) setProfile(data);
      } catch (err) {
        if (!cancelled) setError(extractError(err, 'Unable to load profile'));
      }
    }
    loadMe();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-600">Preferences and profile.</p>
      </header>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Profile</h2>
        {profile ? (
          <dl className="mt-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Name</dt>
              <dd className="mt-1 text-slate-800">{profile.name}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Email</dt>
              <dd className="mt-1 text-slate-800">{profile.email}</dd>
            </div>
            {profile.currency && (
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">
                  Account currency
                </dt>
                <dd className="mt-1 text-slate-800">{profile.currency}</dd>
              </div>
            )}
          </dl>
        ) : (
          <p className="mt-3 text-sm text-slate-500">Loading…</p>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Display currency</h2>
        <p className="mt-1 text-xs text-slate-500">
          Used to convert and display totals. Stored on this device.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {SUPPORTED_CURRENCIES.map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => setDisplayCurrency(code)}
              className={[
                'rounded-md border px-3 py-1.5 text-sm',
                code === displayCurrency
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100',
              ].join(' ')}
            >
              {code}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
