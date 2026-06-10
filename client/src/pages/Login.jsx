import { useEffect, useState } from 'react';

/**
 * Placeholder login view. The real authentication form is implemented in
 * task 20.2; this stub exists so the route exists and the protected-route
 * redirect target resolves.
 */
export default function Login() {
  const [sessionExpired, setSessionExpired] = useState(false);

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
      /* ignore storage errors */
    }
  }, []);

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">Nuvault</h1>
        <p className="mt-2 text-sm text-slate-600">
          Sign in to continue. (Login form lands in the next task.)
        </p>
        {sessionExpired && (
          <p
            role="alert"
            className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800"
          >
            Your session has expired. Please log in again.
          </p>
        )}
      </div>
    </main>
  );
}
