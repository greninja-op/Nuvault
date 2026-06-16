import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeftRight,
  Briefcase,
  Calculator,
  CreditCard,
  Grid3X3,
  Landmark,
  LayoutDashboard,
  PieChart,
  Receipt,
  Settings as SettingsIcon,
  Sparkles,
  Target,
  TrendingUp,
} from 'lucide-react';
import apiClient from '../api/client';
import { useAuth } from '../auth/AuthContext';
import useWindowSize from '../hooks/useWindowSize';
import PageTransition from './PageTransition';

const SIDEBAR_WIDTH = 220;

/** Full navigation set (real Nuvault routes). */
const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { to: '/budgets', label: 'Budget', icon: PieChart },
  { to: '/assets', label: 'Assets', icon: Landmark },
  { to: '/liabilities', label: 'Liabilities', icon: CreditCard },
  { to: '/portfolio', label: 'Portfolio', icon: Briefcase },
  { to: '/investments', label: 'Investments', icon: TrendingUp },
  { to: '/goals', label: 'Goals', icon: Target },
  { to: '/bills', label: 'Bills', icon: Receipt },
  { to: '/calculators', label: 'Calculators', icon: Calculator },
  { to: '/chat', label: 'AI Advisor', icon: Sparkles },
];

const SETTINGS_ITEM = { to: '/settings', label: 'Settings', icon: SettingsIcon };

/** Mobile bottom-bar primary destinations (4 + a "More" button). */
const MOBILE_PRIMARY = ['/', '/transactions', '/budgets', '/chat'];

/** Destinations shown inside the mobile "More" drawer. */
const DRAWER_ITEMS = NAV_ITEMS.filter((i) => !MOBILE_PRIMARY.includes(i.to)).concat(SETTINGS_ITEM);

/** Brand wordmark: "Nu" in accent, "vault" muted, with a vault glyph. */
function Logo() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="5" stroke="var(--accent)" strokeWidth="2" />
        <circle cx="12" cy="11" r="3" stroke="var(--accent)" strokeWidth="2" />
        <path d="M12 14v4" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span style={{ fontSize: 20, fontFamily: 'Poppins', fontWeight: 700 }}>
        <span style={{ color: 'var(--accent)' }}>Nu</span>
        <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>vault</span>
      </span>
    </div>
  );
}

function initialsOf(name, email) {
  const src = (name || email || '?').trim();
  return src.charAt(0).toUpperCase();
}

export default function AppShell() {
  const { user } = useAuth();
  const { isMobile } = useWindowSize();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [profile, setProfile] = useState(null);

  // The auth context only holds the user object for the session in which the
  // user logged in; after a reload only the token is hydrated (no profile is
  // persisted in localStorage by design). Rehydrate name/email from /auth/me
  // so the sidebar shows the real account instead of a placeholder.
  useEffect(() => {
    if (user) return undefined;
    let cancelled = false;
    apiClient
      .get('/auth/me')
      .then(({ data }) => {
        if (!cancelled) setProfile(data);
      })
      .catch(() => {
        /* ignore — fall back to placeholder display */
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const account = user || profile;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      {!isMobile && <DesktopSidebar user={account} />}

      <main
        style={{
          marginLeft: isMobile ? 0 : SIDEBAR_WIDTH,
          minHeight: '100vh',
          background: 'var(--bg-base)',
        }}
      >
        <div
          style={{
            padding: isMobile ? 16 : 28,
            paddingBottom: isMobile ? 'calc(72px + env(safe-area-inset-bottom))' : 28,
          }}
        >
          <PageTransition>
            <Outlet />
          </PageTransition>
        </div>
      </main>

      {isMobile && (
        <MobileBottomNav onMore={() => setDrawerOpen(true)} />
      )}

      <AnimatePresence>
        {isMobile && drawerOpen && <MoreDrawer onClose={() => setDrawerOpen(false)} />}
      </AnimatePresence>
    </div>
  );
}

/* ── Desktop sidebar ───────────────────────────────────────────────────────*/
function DesktopSidebar({ user }) {
  return (
    <aside
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        bottom: 0,
        width: SIDEBAR_WIDTH,
        background: 'var(--bg-surface)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        padding: '20px 12px',
        zIndex: 20,
      }}
    >
      <div style={{ marginBottom: 28, paddingLeft: 8 }}>
        <Logo />
      </div>

      <nav
        style={{
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        {NAV_ITEMS.map((item) => (
          <SidebarLink key={item.to} item={item} />
        ))}

        <div style={{ height: 1, background: 'var(--border)', margin: '10px 8px' }} />

        <SidebarLink item={SETTINGS_ITEM} />
      </nav>

      {/* Bottom user identity */}
      <div
        style={{
          marginTop: 8,
          paddingTop: 16,
          borderTop: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: 'var(--accent-muted)',
            color: 'var(--accent)',
            fontSize: 13,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {initialsOf(user?.name, user?.email)}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--text-primary)',
              maxWidth: 140,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {user?.name || 'Account'}
          </div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              maxWidth: 140,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {user?.email || ''}
          </div>
        </div>
      </div>
    </aside>
  );
}

function SidebarLink({ item }) {
  const Icon = item.icon;
  const [hover, setHover] = useState(false);
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={({ isActive }) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 12px',
        borderRadius: 'var(--radius-md)',
        textDecoration: 'none',
        fontSize: 14,
        fontWeight: 500,
        fontFamily: 'Poppins',
        transition: 'all 150ms var(--ease)',
        color: isActive
          ? 'var(--accent)'
          : hover
            ? 'var(--text-primary)'
            : 'var(--text-secondary)',
        background: isActive
          ? 'var(--accent-muted)'
          : hover
            ? 'var(--bg-hover)'
            : 'transparent',
        boxShadow: isActive ? 'inset 3px 0 0 var(--accent)' : 'none',
      })}
    >
      {({ isActive }) => (
        <>
          <Icon
            size={20}
            strokeWidth={1.75}
            style={{ color: isActive ? 'var(--accent)' : 'inherit', flexShrink: 0 }}
          />
          <span>{item.label}</span>
        </>
      )}
    </NavLink>
  );
}

/* ── Mobile bottom navigation ──────────────────────────────────────────────*/
function MobileBottomNav({ onMore }) {
  const primaryItems = MOBILE_PRIMARY.map((to) => NAV_ITEMS.find((i) => i.to === to)).filter(
    Boolean,
  );

  return (
    <nav
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: 60,
        background: 'var(--bg-surface)',
        borderTop: '1px solid var(--border)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        zIndex: 100,
        display: 'flex',
      }}
    >
      {primaryItems.map((item) => (
        <BottomNavItem key={item.to} item={item} />
      ))}
      <motion.button
        type="button"
        onClick={onMore}
        whileTap={{ scale: 0.85 }}
        aria-label="More"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 3,
          padding: '8px 4px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text-muted)',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <Grid3X3 size={22} strokeWidth={1.75} />
        <span style={{ fontSize: 10, fontWeight: 500 }}>More</span>
      </motion.button>
    </nav>
  );
}

function BottomNavItem({ item }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      style={{ flex: 1, textDecoration: 'none', WebkitTapHighlightColor: 'transparent' }}
    >
      {({ isActive }) => (
        <motion.div
          whileTap={{ scale: 0.85 }}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 3,
            padding: '8px 4px',
            color: isActive ? 'var(--accent)' : 'var(--text-muted)',
            transition: 'color 150ms var(--ease)',
          }}
        >
          <Icon size={22} strokeWidth={1.75} />
          <span
            style={{
              fontSize: 10,
              fontWeight: 500,
              height: isActive ? 'auto' : 0,
              overflow: 'hidden',
            }}
          >
            {item.label}
          </span>
        </motion.div>
      )}
    </NavLink>
  );
}

/* ── Mobile "More" drawer ──────────────────────────────────────────────────*/
function MoreDrawer({ onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200 }}>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }}
      />
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          background: 'var(--bg-surface)',
          borderRadius: 'var(--radius-xl) var(--radius-xl) 0 0',
          borderTop: '1px solid var(--border)',
          padding: '12px 20px 32px',
        }}
      >
        <div
          style={{
            width: 32,
            height: 4,
            background: 'var(--border)',
            borderRadius: 'var(--radius-full)',
            margin: '0 auto 16px',
          }}
        />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {DRAWER_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={onClose}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 6,
                  padding: 14,
                  borderRadius: 'var(--radius-lg)',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                  textDecoration: 'none',
                  color: 'var(--text-secondary)',
                }}
              >
                <Icon size={24} strokeWidth={1.75} />
                <span style={{ fontSize: 12, fontWeight: 500 }}>{item.label}</span>
              </NavLink>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
}
