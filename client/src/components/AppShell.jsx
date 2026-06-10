import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
  SUPPORTED_CURRENCIES,
  useDisplayCurrency,
} from '../currency/CurrencyContext';

/**
 * Shell layout wrapping every protected route. Renders a left sidebar
 * with the feature nav, a top bar with the display-currency selector
 * and a logout button, and an `<Outlet />` for the current page.
 */
export default function AppShell() {
  const { user, logout } = useAuth();
  const { displayCurrency, setDisplayCurrency } = useDisplayCurrency();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  const navItems = [
    { to: '/', label: 'Dashboard', end: true },
    { to: '/assets', label: 'Assets' },
    { to: '/liabilities', label: 'Liabilities' },
    { to: '/transactions', label: 'Transactions' },
    { to: '/budgets', label: 'Budgets' },
    { to: '/investments', label: 'Investments' },
    { to: '/portfolio', label: 'Portfolio' },
    { to: '/goals', label: 'Goals' },
    { to: '/bills', label: 'Bills' },
    { to: '/calculators', label: 'Calculators' },
    { to: '/chat', label: 'AI Advisor' },
    { to: '/settings', label: 'Settings' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex min-h-screen">
        <aside className="hidden w-56 flex-shrink-0 border-r border-slate-200 bg-white p-4 md:block">
          <div className="text-lg font-semibold text-slate-900">Nuvault</div>
          <nav className="mt-6 space-y-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  [
                    'block rounded-md px-3 py-2 text-sm font-medium',
                    isActive
                      ? 'bg-indigo-50 text-indigo-700'
                      : 'text-slate-700 hover:bg-slate-100',
                  ].join(' ')
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>

        <div className="flex flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:px-6">
            <div className="flex items-center gap-4">
              <span className="text-sm text-slate-600 md:hidden">Nuvault</span>
              <span className="hidden text-sm text-slate-600 md:inline">
                {user?.name ? `Hi, ${user.name}` : 'Welcome'}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                <span>Currency</span>
                <select
                  aria-label="Display currency"
                  value={displayCurrency}
                  onChange={(event) => setDisplayCurrency(event.target.value)}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  {SUPPORTED_CURRENCIES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
              >
                Log out
              </button>
            </div>
          </header>

          <main className="flex-1 px-4 py-6 md:px-8">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
