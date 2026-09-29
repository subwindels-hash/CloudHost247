// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PaymentModal from '../../src/components/PaymentModal';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Phase 5E: PaymentModal Component', () => {
  it('renders gateway options and executes manual payment initiation with instructions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/v1/invoices/inv-1/payments') && init?.method === 'POST') {
          return {
            ok: true,
            status: 201,
            json: async () => ({
              payment: {
                id: 'pay-123',
                invoiceId: 'inv-1',
                provider: 'manual',
                providerReference: null,
                method: 'bank_transfer',
                amount: '49.99',
                currency: 'USD',
                status: 'pending',
                failureReason: null,
                initiatedAt: '2026-09-29T00:00:00Z',
                completedAt: null,
                instructions: 'Transfer to Acme Bank Account #123456789',
              },
            }),
          };
        }
        return { ok: false, status: 404, json: async () => ({ error: 'NOT_FOUND' }) };
      })
    );

    const onClose = vi.fn();
    render(
      <PaymentModal
        isOpen={true}
        invoiceId="inv-1"
        invoiceNumber="INV-00000001"
        totalAmount="49.99"
        currency="USD"
        onClose={onClose}
      />
    );

    expect(screen.getByText('Pay Invoice INV-00000001')).toBeTruthy();
    expect(screen.getByText('Manual Bank Transfer / Wire')).toBeTruthy();
    expect(screen.getByText('Sandbox Gateway (Demo / Testing)')).toBeTruthy();

    const submitBtn = screen.getByRole('button', { name: 'Proceed to Payment' });
    await userEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('Bank Transfer Instructions')).toBeTruthy();
      expect(screen.getByText('Transfer to Acme Bank Account #123456789')).toBeTruthy();
    });
  });

  it('handles sandbox payment initiation and displays provider reference', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/v1/invoices/inv-2/payments') && init?.method === 'POST') {
          return {
            ok: true,
            status: 201,
            json: async () => ({
              payment: {
                id: 'pay-sandbox-123',
                invoiceId: 'inv-2',
                provider: 'sandbox',
                providerReference: 'sandbox_ref_abcdef123456',
                method: 'sandbox_demo',
                amount: '29.99',
                currency: 'USD',
                status: 'pending',
                failureReason: null,
                initiatedAt: '2026-09-29T00:00:00Z',
                completedAt: null,
              },
            }),
          };
        }
        return { ok: false, status: 404, json: async () => ({ error: 'NOT_FOUND' }) };
      })
    );

    const onPaymentSuccess = vi.fn();
    render(
      <PaymentModal
        isOpen={true}
        invoiceId="inv-2"
        invoiceNumber="INV-00000002"
        totalAmount="29.99"
        currency="USD"
        onClose={() => {}}
        onPaymentSuccess={onPaymentSuccess}
      />
    );

    // Select sandbox radio
    const sandboxRadio = screen.getByLabelText(/Sandbox Gateway/);
    await userEvent.click(sandboxRadio);

    const submitBtn = screen.getByRole('button', { name: 'Proceed to Payment' });
    await userEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('Sandbox Payment Initiated')).toBeTruthy();
      expect(screen.getByText('sandbox_ref_abcdef123456')).toBeTruthy();
    });
    expect(onPaymentSuccess).toHaveBeenCalled();
  });
});
