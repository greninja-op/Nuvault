import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import ProtectedRoute from './auth/ProtectedRoute';
import { CurrencyProvider } from './currency/CurrencyContext';
import AppShell from './components/AppShell';
import useTheme from './hooks/useTheme';

import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Assets from './pages/Assets';
import Liabilities from './pages/Liabilities';
import Transactions from './pages/Transactions';
import Budgets from './pages/Budgets';
import Investments from './pages/Investments';
import Portfolio from './pages/Portfolio';
import Goals from './pages/Goals';
import Bills from './pages/Bills';
import Calculators from './pages/Calculators';
import AiChat from './pages/AiChat';
import Settings from './pages/Settings';
import NotFound from './pages/NotFound';

/**
 * Top-level Nuvault app. AuthProvider drives session state, CurrencyProvider
 * persists and applies the user's display currency, and the AppShell wraps
 * every protected route in a sidebar layout.
 */
export default function App() {
  // Activate the theme controller: applies the persisted theme (`.light`
  // class on <html>, or dark by default) on mount and keeps it in sync.
  useTheme();

  return (
    <AuthProvider>
      <CurrencyProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route
              element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              }
            >
              <Route index element={<Dashboard />} />
              <Route path="assets" element={<Assets />} />
              <Route path="liabilities" element={<Liabilities />} />
              <Route path="transactions" element={<Transactions />} />
              <Route path="budgets" element={<Budgets />} />
              <Route path="investments" element={<Investments />} />
              <Route path="portfolio" element={<Portfolio />} />
              <Route path="goals" element={<Goals />} />
              <Route path="bills" element={<Bills />} />
              <Route path="calculators" element={<Calculators />} />
              <Route path="chat" element={<AiChat />} />
              <Route path="settings" element={<Settings />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </CurrencyProvider>
    </AuthProvider>
  );
}
