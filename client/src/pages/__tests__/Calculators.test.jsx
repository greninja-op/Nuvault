import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import Calculators from '../Calculators';
import { renderWithProviders } from '../../test-utils/renderWithProviders';

describe('Calculators', () => {
  it('renders the page and shows the default SIP calculator with a result', () => {
    renderWithProviders(<Calculators />);

    // Page heading.
    expect(
      screen.getByRole('heading', { name: /finance calculators/i }),
    ).toBeInTheDocument();

    // SIP tab is active by default and its controls are visible.
    expect(screen.getByText(/monthly investment/i)).toBeInTheDocument();

    // The results breakdown shows the SIP summary rows.
    expect(screen.getByText(/invested amount/i)).toBeInTheDocument();
    expect(screen.getByText(/est\. returns/i)).toBeInTheDocument();

    // With default values (₹10,000/mo, 12%, 10 yr) invested = ₹12,00,000.
    // Assert the invested amount is rendered as a formatted currency value.
    const totalValueRows = screen.getAllByText(/total value/i);
    expect(totalValueRows.length).toBeGreaterThan(0);

    // A formatted INR amount (contains the ₹ grouping) is present.
    expect(screen.getAllByText(/₹/).length).toBeGreaterThan(0);
  });
});
