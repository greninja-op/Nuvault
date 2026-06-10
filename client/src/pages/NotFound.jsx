import { Link } from 'react-router-dom';

/** Simple 404 fallback. */
export default function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="text-center">
        <h1 className="text-3xl font-semibold text-slate-900">404</h1>
        <p className="mt-2 text-sm text-slate-600">That page does not exist.</p>
        <Link to="/" className="mt-4 inline-block text-sm text-indigo-600 hover:underline">
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
