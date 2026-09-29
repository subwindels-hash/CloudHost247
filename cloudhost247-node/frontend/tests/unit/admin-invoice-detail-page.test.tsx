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

describe('Phase 5F: /admin/invoices/:id — Staff Invoice Detail & Management', () => {
  it('renders invoice breakdown, payment attempts, and allows opening refund modal', async () => {
    setSession('token', ADMIN_USER);
    const mockInvoice = {
      id: 'inv-202',
      invoiceNumber: 'INV-00000202',
      orderId: 'ord-202',
      orderNumber: 'CH-00000202',
      userId: 'u2',
      userEmail: 'bob@example.com',
      userFullName: 'Bob Builder',
      status: 'paid',
      currency: 'USD',
      subtotalAmount: '80.00',
      discountAmount: '0.00',
      taxAmount: '0.00',
      totalAmount: '80.00',
      dueDate: '2026-09-29',
      issuedAt: '2026-09-29T10:00:00Z',
      items: [
        {
          id: 'item-1',
          planId: 'p1',
          productName: 'cPanel Hosting',
          planName: 'Standard',
          billingPeriod: 'monthly',
          quantity: 1,
          unitPriceAmount: '80.00',
          lineTotalAmount: '80.00',
          currency: 'USD',
        },
      ],
      ledger: [
        {
          id: 'led-1',
          entryType: 'charge',
          amount: '80.00',
          currency: 'USD',
          description: 'Charge for invoice INV-00000202',
          createdAt: '2026-09-29T10:00:00Z',
        },
        {
          id: 'led-2',
          entryType: 'payment',
          amount: '80.00',
          currency: 'USD',
          description: 'Manual payment confirmed',
          createdAt: '2026-09-29T10:05:00Z',
        },
      ],
      payments: [
        {
          id: 'pay-1',
          invoiceId: 'inv-202',
          provider: 'manual',
          providerReference: 'BANK-REF-123',
          method: 'bank_transfer',
          amount: '80.00',
          currency: 'USD',
          status: 'successful',
          failureReason: null,
          initiatedAt: '2026-09-29T10:01:00Z',
          completedAt: '2026-09-29T10:05:00Z',
        },
      ],
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/v1/admin/invoices/inv-202')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ invoice: mockInvoice }),
          };
        }
        return meResponse();
      })
    );

    render(
      <MemoryRouter initialEntries={['/admin/invoices/inv-202']}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByText('Invoice INV-00000202')).toBeTruthy();
    expect(screen.getByText('Bob Builder')).toBeTruthy();
    expect(screen.getByText('bob@example.com')).toBeTruthy();
    expect(screen.getByText('cPanel Hosting — Standard')).toBeTruthy();
    expect(screen.getByText('Issue Refund')).toBeTruthy();

    // Click Issue Refund
    await userEvent.click(screen.getByText('Issue Refund'));
    expect(await screen.findByText('Issue Refund — Invoice INV-00000202')).toBeTruthy();
    expect(screen.getByText('Max Refundable Balance:')).toBeTruthy();
  });
});
