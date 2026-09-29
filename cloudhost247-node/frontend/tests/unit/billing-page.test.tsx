// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App';
import { clearSession, setSession } from '../../src/lib/auth';

const SIGNED_IN = { id: 'u1', email: 'ada@example.com', fullName: 'Ada Lovelace', role: 'customer' };

function meResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      user: { id: 'u1', email: 'ada@example.com', fullName: 'Ada Lovelace', role: 'customer', status: 'active' },
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

describe('Phase 5E: /billing — Billing & Ledger Dashboard', () => {
  it('renders account balance due, unpaid invoices alert, and transaction ledger table', async () => {
    setSession('token', SIGNED_IN);
    const mockInvoices = [
      {
        id: 'inv-1',
        invoiceNumber: 'INV-00000001',
        orderId: 'ord-1',
        orderNumber: 'CH-10000001',
        status: 'unpaid',
        currency: 'USD',
        subtotalAmount: '49.99',
        discountAmount: '0.00',
        taxAmount: '0.00',
        totalAmount: '49.99',
        dueDate: '2026-10-15T00:00:00Z',
        issuedAt: '2026-09-29T00:00:00Z',
      },
    ];

    const mockLedger = [
      {
        id: 'led-1',
        entryType: 'charge',
        amount: '49.99',
        currency: 'USD',
        description: 'Invoice INV-00000001 for order CH-10000001',
        createdAt: '2026-09-29T00:00:00Z',
      },
    ];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/v1/invoices')) {
          return { ok: true, status: 200, json: async () => ({ invoices: mockInvoices }) };
        }
        if (url.includes('/api/v1/billing/ledger')) {
          return { ok: true, status: 200, json: async () => ({ ledger: mockLedger }) };
        }
        return meResponse();
      })
    );

    render(
      <MemoryRouter initialEntries={['/billing']}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByText('Billing & Ledger')).toBeTruthy();
    expect(screen.getByText('Account Balance Due')).toBeTruthy();
    expect(screen.getByText('$49.99')).toBeTruthy();
    expect(screen.getByText(/You have 1 unpaid invoice/)).toBeTruthy();
    expect(screen.getByText('Transaction Ledger')).toBeTruthy();
    expect(screen.getByText('Invoice INV-00000001 for order CH-10000001')).toBeTruthy();
  });
});
