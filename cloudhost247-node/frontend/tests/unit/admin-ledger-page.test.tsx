// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App';
import { clearSession, setSession } from '../../src/lib/auth';

const ADMIN_USER = { id: 'admin-1', email: 'admin@example.com', fullName: 'Staff Admin', role: 'admin' };

function meResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      user: { id: 'admin-1', email: 'admin@example.com', fullName: 'Staff Admin', role: 'admin', status: 'active' },
    }),
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  clearSession();
  vi.unstubAllGlobals();
});

describe('Phase 5F: /admin/ledger — Staff Global Financial Audit Ledger', () => {
  it('renders global ledger with entry types and customer attribution', async () => {
    setSession('token', ADMIN_USER);
    const mockLedger = [
      {
        id: 'led-1',
        userId: 'u1',
        userEmail: 'alice@example.com',
        userFullName: 'Alice Smith',
        invoiceId: 'inv-1',
        invoiceNumber: 'INV-00000001',
        entryType: 'charge',
        amount: '150.00',
        currency: 'USD',
        description: 'Invoice INV-00000001 issued',
        createdAt: '2026-09-29T10:00:00Z',
      },
      {
        id: 'led-2',
        userId: 'u1',
        userEmail: 'alice@example.com',
        userFullName: 'Alice Smith',
        invoiceId: 'inv-1',
        invoiceNumber: 'INV-00000001',
        entryType: 'payment',
        amount: '150.00',
        currency: 'USD',
        description: 'Payment settled',
        createdAt: '2026-09-29T10:05:00Z',
      },
    ];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/v1/admin/billing/ledger')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ ledger: mockLedger, total: 2, page: 1, limit: 20 }),
          };
        }
        return meResponse();
      })
    );

    render(
      <MemoryRouter initialEntries={['/admin/ledger']}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByText('Global Financial Audit Ledger')).toBeTruthy();
    expect(await screen.findByText('Invoice INV-00000001 issued')).toBeTruthy();
    expect(screen.getByText('Payment settled')).toBeTruthy();
    expect(screen.getAllByText('Alice Smith').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$150.00 USD').length).toBe(2);
  });
});
