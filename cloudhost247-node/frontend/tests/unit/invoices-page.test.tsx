// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

describe('Phase 5E: /invoices — Customer Invoices List', () => {
  it('renders honest empty state when customer has no invoices', async () => {
    setSession('token', SIGNED_IN);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/v1/invoices')) {
          return { ok: true, status: 200, json: async () => ({ invoices: [] }) };
        }
        return meResponse();
      })
    );

    render(
      <MemoryRouter initialEntries={['/invoices']}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByText('No Invoices Found')).toBeTruthy();
    expect(screen.getByText('Browse Products')).toBeTruthy();
  });

  it('lists customer invoices with correct status badges and opens payment modal on Pay Now', async () => {
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
      {
        id: 'inv-2',
        invoiceNumber: 'INV-00000002',
        orderId: 'ord-2',
        orderNumber: 'CH-10000002',
        status: 'paid',
        currency: 'USD',
        subtotalAmount: '19.99',
        discountAmount: '0.00',
        taxAmount: '0.00',
        totalAmount: '19.99',
        dueDate: '2026-10-01T00:00:00Z',
        issuedAt: '2026-09-01T00:00:00Z',
      },
    ];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/v1/invoices')) {
          return { ok: true, status: 200, json: async () => ({ invoices: mockInvoices }) };
        }
        return meResponse();
      })
    );

    render(
      <MemoryRouter initialEntries={['/invoices']}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByText('INV-00000001')).toBeTruthy();
    expect(screen.getByText('INV-00000002')).toBeTruthy();
    expect(screen.getByText('$49.99')).toBeTruthy();
    expect(screen.getByText('unpaid')).toBeTruthy();
    expect(screen.getByText('paid')).toBeTruthy();

    // Click "Pay Now" on unpaid invoice
    const payNowBtn = screen.getByRole('button', { name: 'Pay Now' });
    await userEvent.click(payNowBtn);

    // Modal opens
    await waitFor(() => {
      expect(screen.getByText('Pay Invoice INV-00000001')).toBeTruthy();
    });
  });
});
