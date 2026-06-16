import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Mail, Moon, User as UserIcon } from 'lucide-react';
import apiClient from '../api/client';
import { useAuth } from '../auth/AuthContext';
import {
  SUPPORTED_CURRENCIES,
  useDisplayCurrency,
} from '../currency/CurrencyContext';
import useTheme from '../hooks/useTheme';
import { extractError } from '../lib/format';
import Toggle from '../components/ui/Toggle';
import Button from '../components/ui/Button';

/**
 * Settings view. Houses the three preferences that used to live in the
 * sidebar/drawer:
 *   - Appearance: light/dark theme toggle (wired to the existing `useTheme`
 *     hook — the same controller App mounts, persisted in localStorage).
 *   - Regional: display-currency selector (wired to `useDisplayCurrency`).
 *   - Account: profile from `GET /auth/me` + logout (same best-effort
 *     `POST /auth/logout` → local logout → redirect flow the shell used).
 */
export default function Settings() {
  const { displayCurrency, setDisplayCurrency } = useDisplayCurrency();
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(user ?? null);
  const [error, setError] = useState(null);
  const [loggingOut, setLoggingOut] = useState(false);

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

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await apiClient.post('/auth/logout');
    } catch {
      /* best-effort — proceed with local logout regardless */
    }
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
          Settings
        </h1>
      </div>

      {error && (
        <p
          role="alert"
          style={{
            background: 'var(--red-muted)',
            color: 'var(--red)',
            borderRadius: 'var(--radius-md)',
            padding: '8px 12px',
            fontSize: 13,
            marginBottom: 20,
          }}
        >
          {error}
        </p>
      )}

      {/* Appearance */}
      <SectionCard title="Appearance">
        <SettingRow
          label="Theme"
          hint="Switch between light and dark."
          control={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Moon size={16} strokeWidth={1.75} color="var(--text-muted)" />
              <Toggle checked={theme === 'dark'} onChange={toggleTheme} label="Dark mode" />
            </div>
          }
        />
      </SectionCard>

      {/* Regional */}
      <SectionCard title="Regional">
        <SettingRow
          label="Currency"
          hint="Used to convert and display totals. Stored on this device."
          control={
            <select
              aria-label="Display currency"
              value={displayCurrency}
              onChange={(e) => setDisplayCurrency(e.target.value)}
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                padding: '11px 14px',
                fontFamily: 'Poppins, system-ui, sans-serif',
                fontSize: 14,
                color: 'var(--text-primary)',
                outline: 'none',
                minWidth: 120,
              }}
            >
              {SUPPORTED_CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          }
        />
      </SectionCard>

      {/* Account */}
      <SectionCard title="Account">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                background: 'var(--accent-muted)',
                color: 'var(--accent)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 16,
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              {(profile?.name || profile?.email || '?').trim().charAt(0).toUpperCase()}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
                <UserIcon size={14} strokeWidth={1.75} color="var(--text-muted)" />
                {profile?.name || 'Account'}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                <Mail size={14} strokeWidth={1.75} color="var(--text-muted)" />
                {profile?.email || ''}
              </div>
            </div>
          </div>

          <Button variant="danger" fullWidth loading={loggingOut} onClick={handleLogout}>
            <LogOut size={16} strokeWidth={2} />
            Log out
          </Button>
        </div>
      </SectionCard>
    </div>
  );
}

/* ── Presentational helpers ────────────────────────────────────────────────*/

function SectionCard({ title, children }) {
  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        padding: 20,
        marginBottom: 20,
      }}
    >
      <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 16 }}>
        {title}
      </h2>
      {children}
    </div>
  );
}

function SettingRow({ label, hint, control }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>{label}</div>
        {hint && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{hint}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{control}</div>
    </div>
  );
}
