import { useAuth } from '../auth/AuthContext';

/**
 * Placeholder landing page rendered behind ProtectedRoute. The full
 * dashboard (net worth, charts, etc.) is implemented in task 20.2.
 */
export default function Dashboard() {
  const { logout } = useAuth();
  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-3xl">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-slate-900">Nuvault</h1>
          <button
            type="button"
            onClick={logout}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
          >
            Log out
          </button>
        </header>
        <p className="mt-4 text-sm text-slate-600">
          You are signed in. The dashboard views land in the next task.
        </p>
      </div>
    </main>
  );
}
