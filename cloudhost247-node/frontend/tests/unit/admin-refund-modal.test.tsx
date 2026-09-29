// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminRefundModal } from '../../src/components/AdminRefundModal';
import type { AdminInvoiceDetail } from '../../src/lib/admin-billing-api';

const mockInvoice: AdminInvoiceDetail = {
  id: 'inv-303',
  invoiceNumber: 'INV-00000303',
  orderId: 'ord-303',
  orderNumber: 'CH-00000303',
  userId: 'u3',
  userEmail: 'charlie@example.com',
  userFullName: 'Charlie Brown',
  status: 'paid',
  currency: 'USD',
  subtotalAmount: '50.00',
  discountAmount: '0.00',
  taxAmount: '0.00',
  totalAmount: '50.00',
  dueDate: '2026-09-29',
  issuedAt: '2026-09-29T10:00:00Z',
  items: [],
  ledger: [
    {
      id: 'led-1',
      entryType: 'charge',
      amount: '50.00',
      currency: 'USD',
      description: 'Charge',
      createdAt: '2026-09-29T10:00:00Z',
    },
    {
      id: 'led-2',
      entryType: 'payment',
      amount: '50.00',
      currency: 'USD',
      description: 'Payment',
      createdAt: '2026-09-29T10:05:00Z',
    },
  ],
  payments: [],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Phase 5F: AdminRefundModal Component', () => {
  it('submits a valid refund amount with mandatory reason', async () => {
    const handleSuccess = vi.fn();
    const handleClose = vi.fn();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          invoice: { ...mockInvoice, status: 'refunded' },
        }),
      }))
    );

    render(
      <AdminRefundModal
        isOpen={true}
        onClose={handleClose}
        invoice={mockInvoice}
        onRefundSuccess={handleSuccess}
      />
    );

    expect(screen.getByText('Issue Refund — Invoice INV-00000303')).toBeTruthy();
    expect(screen.getAllByText('$50.00 USD').length).toBeGreaterThan(0);

    const reasonInput = screen.getByPlaceholderText(/Customer requested cancellation/i);
    await userEvent.type(reasonInput, 'Service dissatisfaction refund');

    const submitBtn = screen.getByText('Confirm Refund');
    await userEvent.click(submitBtn);

    await waitFor(() => {
      expect(handleSuccess).toHaveBeenCalled();
      expect(handleClose).toHaveBeenCalled();
    });
  });

  it('rejects submission with empty reason', async () => {
    const handleSuccess = vi.fn();
    const handleClose = vi.fn();

    render(
      <AdminRefundModal
        isOpen={true}
        onClose={handleClose}
        invoice={mockInvoice}
        onRefundSuccess={handleSuccess}
      />
    );

    const submitBtn = screen.getByText('Confirm Refund');
    await userEvent.click(submitBtn);

    expect(handleSuccess).not.toHaveBeenCalled();
  });
});
