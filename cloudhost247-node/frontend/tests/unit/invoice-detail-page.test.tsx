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

describe('Phase 5E: /invoices/:id — Invoice Detail & Receipt', () => {
  it('renders complete invoice breakdown, line items, and payment attempt history', async () => {
    setSession('token', SIGNED_IN);
    const mockDetail = {
      id: 'inv-detail-1',
      invoiceNumber: 'INV-12345678',
      orderId: 'ord-1',
      orderNumber: 'CH-99999999',
      status: 'unpaid',
      currency: 'USD',
      subtotalAmount: '49.99',
      discountAmount: '0.00',
      taxAmount: '0.00',
      totalAmount: '49.99',
      dueDate: '2026-10-15T00:00:00Z',
      issuedAt: '2026-09-29T00:00:00Z',
      items: [
        {
          id: 'item-1',
          planId: 'p-1',
          billingPeriod: 'monthly',
          quantity: 1,
          unitPriceAmount: '49.99',
          lineTotalAmount: '49.99',
          currency: 'USD',
          productName: 'Cloud VPS',
          planName: 'Starter VPS',
        },
      ],
      ledger: [
        {
          id: 'led-1',
          entryType: 'charge',
          amount: '49.99',
          currency: 'USD',
          description: 'Invoice INV-12345678 for order CH-99999999',
          createdAt: '2026-09-29T00:00:00Z',
        },
      ],
      payments: [
        {
          id: 'pay-1',
          invoiceId: 'inv-detail-1',
          provider: 'manual',
          providerReference: null,
          method: 'bank_transfer',
          amount: '49.99',
          currency: 'USD',
          status: 'pending',
          failureReason: null,
          initiatedAt: '2026-09-29T00:00:00Z',
          completedAt: null,
        },
      ],
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/v1/invoices/inv-detail-1')) {
          return { ok: true, status: 200, json: async () => ({ invoice: mockDetail }) };
        }
        return meResponse();
      })
    );

    render(
      <MemoryRouter initialEntries={['/invoices/inv-detail-1']}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByText('INV-12345678')).toBeTruthy();
    expect(screen.getByText('Cloud VPS — Starter VPS')).toBeTruthy();
    expect(screen.getAllByText('$49.99').length).toBeGreaterThan(0);
    expect(screen.getByText('Payment Attempts')).toBeTruthy();
    expect(screen.getByText(/bank_transfer/)).toBeTruthy();

    // "Pay Now" button is visible for unpaid invoice
    expect(screen.getByRole('button', { name: 'Pay Now' })).toBeTruthy();
  });

  it('renders 404 cleanly when invoice does not exist', async () => {
    setSession('token', SIGNED_IN);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/v1/invoices/not-found')) {
          return { ok: false, status: 404, json: async () => ({ error: 'NOT_FOUND', message: 'No invoice was found' }) };
        }
        return meResponse();
      })
    );

    render(
      <MemoryRouter initialEntries={['/invoices/not-found']}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByText('Invoice Not Found')).toBeTruthy();
  });
});
