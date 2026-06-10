import { MemoryRouter } from 'react-router-dom';
import { render } from '@testing-library/react';
import { AuthProvider } from '../auth/AuthContext';
import { CurrencyProvider } from '../currency/CurrencyContext';

/**
 * Render a component inside the contexts every protected page expects:
 * memory router (so navigation is in-test), AuthProvider, and
 * CurrencyProvider. The caller can pass a custom `route` for routing
 * tests.
 */
export function renderWithProviders(ui, { route = '/' } = {}) {
  return render(
    <AuthProvider>
      <CurrencyProvider>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </CurrencyProvider>
    </AuthProvider>,
  );
}
