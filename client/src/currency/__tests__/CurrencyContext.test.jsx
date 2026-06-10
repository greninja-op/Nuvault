import { describe, it, expect, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import {
  CurrencyProvider,
  DEFAULT_DISPLAY_CURRENCY,
  DISPLAY_CURRENCY_STORAGE_KEY,
  SUPPORTED_CURRENCIES,
  useDisplayCurrency,
} from '../CurrencyContext';

function Probe() {
  const { displayCurrency, setDisplayCurrency } = useDisplayCurrency();
  return (
    <div>
      <span data-testid="currency">{displayCurrency}</span>
      <button type="button" onClick={() => setDisplayCurrency('USD')}>set-usd</button>
      <button type="button" onClick={() => setDisplayCurrency('XYZ')}>set-bad</button>
    </div>
  );
}

describe('CurrencyContext', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults to INR when nothing is stored', () => {
    render(
      <CurrencyProvider>
        <Probe />
      </CurrencyProvider>,
    );
    expect(screen.getByTestId('currency').textContent).toBe(DEFAULT_DISPLAY_CURRENCY);
  });

  it('hydrates from local storage when a supported value is present', () => {
    window.localStorage.setItem(DISPLAY_CURRENCY_STORAGE_KEY, 'EUR');
    render(
      <CurrencyProvider>
        <Probe />
      </CurrencyProvider>,
    );
    expect(screen.getByTestId('currency').textContent).toBe('EUR');
  });

  it('persists supported currencies and ignores unknown ones', () => {
    render(
      <CurrencyProvider>
        <Probe />
      </CurrencyProvider>,
    );

    act(() => {
      screen.getByText('set-usd').click();
    });
    expect(screen.getByTestId('currency').textContent).toBe('USD');
    expect(window.localStorage.getItem(DISPLAY_CURRENCY_STORAGE_KEY)).toBe('USD');

    act(() => {
      screen.getByText('set-bad').click();
    });
    // Unsupported value is ignored — still USD.
    expect(screen.getByTestId('currency').textContent).toBe('USD');
  });

  it('exposes the supported currency list including INR/USD/EUR/GBP', () => {
    expect(SUPPORTED_CURRENCIES).toEqual(expect.arrayContaining(['INR', 'USD', 'EUR', 'GBP']));
  });
});
