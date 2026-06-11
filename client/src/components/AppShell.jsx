import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
  SUPPORTED_CURRENCIES,
  useDisplayCurrency,
} from '../currency/CurrencyContext';

/**
 * Inline SVG icon set (no external icon dependency). Each icon is a
 * 20x20 stroke icon that inherits `currentColor`, so Tailwind text-color
 * utilities style it. Keyed by name so nav items can reference an icon
 * declaratively.
 */
function Icon({ name, className = 'h-5 w-5' }) {
  const common = {
    className,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  };
  switch (name) {
    case 'dashboard':
      return (
        <svg {...common}><path d="M3 13h8V3H3zM13 21h8V3h-8zM3 21h8v-6H3z" /></svg>
      );
    case 'assets':
      return (
        <svg {...common}><rect x="3" y="7" width="18" height="12" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /></svg>
      );
    case 'liabilities':
      return (
        <svg {...common}><path d="M12 2v20M5 5h9a3 3 0 0 1 0 6H7a3 3 0 0 0 0 6h10" /></svg>
      );
    case 'transactions':
      return (
        <svg {...common}><path d="M7 7h13M7 7l3-3M7 7l3 3M17 17H4M17 17l-3-3M17 17l-3 3" /></svg>
      );
    case 'budgets':
      return (
        <svg {...common}><path d="M3 3v18h18" /><rect x="7" y="12" width="3" height="6" /><rect x="12" y="8" width="3" height="10" /><rect x="17" y="5" width="3" height="13" /></svg>
      );
    case 'investments':
      return (
        <svg {...common}><path d="M3 17l6-6 4 4 8-8" /><path d="M21 7v5h-5" /></svg>
      );
    case 'portfolio':
      return (
        <svg {...common}><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
      );
    case 'goals':
      return (
        <svg {...common}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></svg>
      );
    case 'bills':
      return (
        <svg {...common}><path d="M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6" /></svg>
      );
    case 'calculators':
      return (
        <svg {...common}><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M8 6h8M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h4M8 18h.01M12 18h.01" /></svg>
      );
    case 'chat':
      return (
        <svg {...common}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
      );
    case 'settings':
      return (
        <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 2.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H7a1.6 1.6 0 0 0 1-1.5V1a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V7a1.6 1.6 0 0 0 1.5 1H23a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></svg>
      );
    case 'more':
      return (
        <svg {...common}><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg>
      );
    case 'menu':
      return (
        <svg {...common}><path d="M3 6h18M3 12h18M3 18h18" /></svg>
      );
    case 'close':
      return (
        <svg {...common}><path d="M18 6 6 18M6 6l12 12" /></svg>
      );
    case 'logout':
      return (
        <svg {...common}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
      );
    default:
      return <svg {...common}><circle cx="12" cy="12" r="9" /></svg>;
  }
}

/**
 * Every navigable destination. `icon` keys into {@link Icon}. The desktop
 * sidebar renders all of these (icon + label); the mobile bottom bar
 * renders a small primary subset plus a "More" button that opens a
 * drawer containing the full list.
 */
const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/assets', label: 'Assets', icon: 'assets' },
  { to: '/liabilities', label: 'Liabilities', icon: 'liabilities' },
  { to: '/transactions', label: 'Transactions', icon: 'transactions' },
  { to: '/budgets', label: 'Budgets', icon: 'budgets' },
  { to: '/investments', label: 'Investments', icon: 'investments' },
  { to: '/portfolio', label: 'Portfolio', icon: 'portfolio' },
  { to: '/goals', label: 'Goals', icon: 'goals' },
  { to: '/bills', label: 'Bills', icon: 'bills' },
  { to: '/calculators', label: 'Calculators', icon: 'calculators' },
  { to: '/chat', label: 'AI Advisor', icon: 'chat' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

/** The handful of destinations shown directly in the mobile bottom bar. */
const MOBILE_PRIMARY = ['/', '/transactions', '/portfolio', '/calculators'];

/**
 * Shell layout wrapping every protected route.
 *
 * Responsive behavior:
 *   - Desktop (md+): persistent left sidebar with icons + labels, a top
 *     bar with greeting + currency selector + logout.
 *   - Mobile (<md): top bar shows the logo + a menu button; primary
 *     destinations live in a fixed bottom navigation bar (icons only);
 *     a slide-up drawer (the "More"/menu button) exposes every
 *     destination, the currency selector, and logout.
 *
 * All breakpoints use Tailwind's sm/md/lg prefixes only — no custom CSS.
 */
export default function AppShell() {
  const { user, logout } = useAuth();
  const { displayCurrency, setDisplayCurrency } = useDisplayCurrency();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  function handleLogout() {
    setMenuOpen(false);
    logout();
    navigate('/login', { replace: true });
  }

  const primaryItems = MOBILE_PRIMARY.map((to) =>
    NAV_ITEMS.find((i) => i.to === to)
  ).filter(Boolean);

  const sidebarLinkClass = ({ isActive }) =>
    [
      'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium',
      isActive
        ? 'bg-indigo-50 text-indigo-700'
        : 'text-slate-700 hover:bg-slate-100',
    ].join(' ');

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex min-h-screen">
        {/* Desktop sidebar (icons + labels) */}
        <aside className="hidden w-56 flex-shrink-0 border-r border-slate-200 bg-white p-4 md:block">
          <div className="px-3 text-lg font-semibold text-slate-900">Nuvault</div>
          <nav className="mt-6 space-y-1">
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={sidebarLinkClass}>
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top bar */}
          <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:px-6">
            <div className="flex items-center gap-3">
              <span className="text-base font-semibold text-slate-900 md:hidden">
                Nuvault
              </span>
              <span className="hidden text-sm text-slate-600 md:inline">
                {user?.name ? `Hi, ${user.name}` : 'Welcome'}
              </span>
            </div>

            <div className="flex items-center gap-3">
              {/* Currency selector — hidden on very small screens (sm+) */}
              <label className="hidden items-center gap-2 text-xs font-medium text-slate-600 sm:flex">
                <span className="hidden md:inline">Currency</span>
                <select
                  aria-label="Display currency"
                  value={displayCurrency}
                  onChange={(event) => setDisplayCurrency(event.target.value)}
                  className="rounded-md border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  {SUPPORTED_CURRENCIES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </label>

              {/* Logout — desktop only (mobile logout lives in the drawer) */}
              <button
                type="button"
                onClick={handleLogout}
                className="hidden rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 md:inline-block"
              >
                Log out
              </button>

              {/* Menu button — mobile only */}
              <button
                type="button"
                onClick={() => setMenuOpen(true)}
                aria-label="Open menu"
                className="flex h-11 w-11 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 md:hidden"
              >
                <Icon name="menu" className="h-6 w-6" />
              </button>
            </div>
          </header>

          {/* Page content. Extra bottom padding on mobile so the fixed
              bottom nav never covers content. */}
          <main className="flex-1 px-4 py-6 pb-24 md:px-8 md:pb-6">
            <Outlet />
          </main>
        </div>
      </div>

      {/* Mobile bottom navigation (icons only) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex items-stretch justify-around border-t border-slate-200 bg-white md:hidden">
        {primaryItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              [
                'flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-[10px] font-medium',
                isActive ? 'text-indigo-700' : 'text-slate-500',
              ].join(' ')
            }
          >
            <Icon name={item.icon} className="h-6 w-6" />
            <span>{item.label}</span>
          </NavLink>
        ))}
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="More"
          className="flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-[10px] font-medium text-slate-500"
        >
          <Icon name="more" className="h-6 w-6" />
          <span>More</span>
        </button>
      </nav>

      {/* Mobile drawer — full nav + currency + logout */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-slate-900/50"
            onClick={() => setMenuOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-base font-semibold text-slate-900">Menu</span>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label="Close menu"
                className="flex h-11 w-11 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100"
              >
                <Icon name="close" className="h-6 w-6" />
              </button>
            </div>

            {/* Currency selector inside drawer (for the smallest screens) */}
            <label className="mb-3 flex items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-3 text-sm font-medium text-slate-700 sm:hidden">
              <span>Display currency</span>
              <select
                aria-label="Display currency"
                value={displayCurrency}
                onChange={(event) => setDisplayCurrency(event.target.value)}
                className="rounded-md border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                {SUPPORTED_CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>

            <nav className="grid grid-cols-2 gap-2">
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) =>
                    [
                      'flex min-h-[48px] items-center gap-3 rounded-md px-3 py-2 text-sm font-medium',
                      isActive
                        ? 'bg-indigo-50 text-indigo-700'
                        : 'text-slate-700 hover:bg-slate-100',
                    ].join(' ')
                  }
                >
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </nav>

            <button
              type="button"
              onClick={handleLogout}
              className="mt-3 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              <Icon name="logout" />
              <span>Log out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
