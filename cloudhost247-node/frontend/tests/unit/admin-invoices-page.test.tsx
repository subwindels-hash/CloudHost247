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

describe('Phase 5F: /admin/invoices — Staff Invoices Directory', () => {
  it('renders admin invoices table with search and filters', async () => {
    setSession('token', ADMIN_USER);
    const mockInvoices = [
      {
        id: 'inv-101',
        invoiceNumber: 'INV-00000101',
        orderId: 'ord-101',
        orderNumber: 'CH-00000101',
        userId: 'u1',
        userEmail: 'alice@example.com',
        userFullName: 'Alice Smith',
        status: 'paid',
        currency: 'USD',
        subtotalAmount: '120.00',
        discountAmount: '0.00',
        taxAmount: '0.00',
        totalAmount: '120.00',
        dueDate: '2026-09-29',
        issuedAt: '2026-09-29T10:00:00Z',
      },
    ];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/v1/admin/invoices')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ invoices: mockInvoices, total: 1, page: 1, limit: 15 }),
          };
        }
        return meResponse();
      })
    );

    render(
      <MemoryRouter initialEntries={['/admin/invoices']}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByText('Admin Invoices & Billing Operations')).toBeTruthy();
    expect(await screen.findByText('INV-00000101')).toBeTruthy();
    expect(screen.getByText('Alice Smith')).toBeTruthy();
    expect(screen.getByText('alice@example.com')).toBeTruthy();
    expect(screen.getByText('$120.00 USD')).toBeTruthy();
    expect(screen.getByText('Manage')).toBeTruthy();
  });
});
