// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { Price } from '../../src/pages/HomePage';
import { CurrencyProvider } from '../../src/currency/CurrencyProvider';
import { LocaleProvider } from '../../src/i18n/LocaleProvider';
import type { PublicPlan } from '../../src/lib/catalog-types';

beforeEach(() => { localStorage.clear(); localStorage.setItem('ch247.currency', 'NGN'); });
afterEach(cleanup);
it('shows the real USD charge and labels the converted amount as an estimate', () => {
  const plan: PublicPlan = { slug: 'sample', name: 'Sample', description: null, billingModel: 'recurring', displayOrder: 0, features: [], pricing: [{ billingPeriod: 'annually', currency: 'USD', amount: 10, setupFee: null }] };
  render(<LocaleProvider initialLocale="en"><CurrencyProvider initialStatus={{ base: 'USD', available: true, reason: null, asOf: null, fetchedAt: null, currencies: [{ code: 'NGN', rate: 1500, observedAt: '2026-01-01T00:00:00Z' }] }}><Price plan={plan} /></CurrencyProvider></LocaleProvider>);
  expect(screen.getByText('$10.00')).toBeTruthy();
  expect(screen.getByText('Billed annually · USD')).toBeTruthy();
  expect(screen.getByText(/About .*15,000.*Charged in USD/)).toBeTruthy();
  expect(screen.queryByText('/mo')).toBeNull();
});
